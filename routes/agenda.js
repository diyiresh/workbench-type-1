"use strict";

const fs = require("fs");
const path = require("path");
const { sendJson, readBody, isLoopback } = require("../lib/http");
const { nowIso } = require("../lib/default-store");
const { chat } = require("../lib/llm");
const agendaNotes = require("../lib/agenda-notes");
const agendaNoteCleanup = require("../lib/agenda-note-cleanup");
const reportExport = require("../lib/agenda-report-export");
const { openInExplorer } = require("../lib/local-opener");

const NOTE_REVIEW = /^\/api\/agendas\/([^/]+)\/review-note\/(draft|saved|refine|save|cleanup)$/;
const NOTE_RESTORE = /^\/api\/agenda-notes\/trash\/([^/]+)\/restore$/;
const NOTE_FILE = /^\/api\/agenda-notes\/([^/]+)$/;
const REPORT_JOB = /^\/api\/agenda\/reports\/jobs\/([a-zA-Z0-9-]+)(?:\/(started|retry|reconcile))?$/;
const EXPORT_PATHS = ["/api/agenda/reports/export/config", "/api/agenda/reports/export/preview", "/api/agenda/reports/export/save"];

function reminderPublicConfig(store) {
  const cfg = (store.remote && store.remote.reminder) || {};
  return {
    provider: cfg.provider || "pushplus",
    enabled: Boolean(cfg.enabled),
    hasToken: Boolean(cfg.token),
    importedFrom: cfg.importedFrom || "",
    migratedAt: cfg.migratedAt || "",
  };
}

async function openAgendaMaterial(store, agendaId, materialIndex) {
  const agenda = (store.agendas || []).find((item) => item.id === agendaId);
  const material = agenda && Array.isArray(agenda.materials) ? agenda.materials[Number(materialIndex)] : null;
  const registeredPath = typeof material === "string" ? material : material && material.path;
  if (!registeredPath) return { ok: false, error: "material_not_found" };
  const target = path.resolve(String(registeredPath));
  if (!fs.existsSync(target)) return { ok: false, error: "path_not_found" };
  const isDirectory = fs.statSync(target).isDirectory();
  try {
    await openInExplorer(target, isDirectory);
    return { ok: true, kind: isDirectory ? "directory" : "file" };
  } catch (err) {
    return { ok: false, error: "explorer_failed", detail: String((err && err.message) || err).slice(0, 180) };
  }
}

// Agenda review notes (docs/SPEC-agenda-review-notes.md), monthly report jobs, report export, reminders.
module.exports = function agendaRoutes({ readStore, writeStore, DATA }) {
  async function reviewNotes({ req, res, p, method, reportManager }) {
    const noteReview = p.match(NOTE_REVIEW), noteRestore = p.match(NOTE_RESTORE), noteFile = p.match(NOTE_FILE);
    try {
      const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) || {} : {};
      const fresh = readStore();
      if (p === "/api/agenda-notes/config" && method === "GET") return sendJson(res, 200, agendaNotes.configured(fresh));
      if (p === "/api/agenda-notes/config" && method === "PUT") {
        const cfg = agendaNotes.normalizeConfig(body);
        agendaNotes.ensureDirectory({ remote: { agendaNotes: cfg } });
        fresh.remote ||= {}; fresh.remote.agendaNotes = cfg; writeStore(fresh);
        return sendJson(res, 200, agendaNotes.configured(fresh));
      }
      if (p === "/api/agenda-notes" && method === "GET") {
        const result = agendaNotes.list(fresh);
        let recovery;
        try { recovery = agendaNoteCleanup.listTrash(fresh); } catch (error) { recovery = { batches: [], ignored: [{ error: error.message }] }; }
        return sendJson(res, 200, { directory: result.directory, ignored: result.ignored, recovery, notes: result.notes.map(note => { const { body, ...metadata } = agendaNotes.publicNote(note); return metadata; }) });
      }
      if (noteRestore && method === "POST") return sendJson(res, 200, agendaNoteCleanup.restore(fresh, decodeURIComponent(noteRestore[1]), body));
      if (noteReview && noteReview[2] === "cleanup") {
        if (method === "GET") return sendJson(res, 200, agendaNoteCleanup.plan(fresh, noteReview[1]));
        if (method === "POST") return sendJson(res, 200, agendaNoteCleanup.moveOlder(fresh, noteReview[1], body));
        return sendJson(res, 405, { error: "method_not_allowed" });
      }
      if (noteReview && method === "GET" && noteReview[2] === "saved") return sendJson(res, 200, agendaNotes.savedDraft(fresh, noteReview[1]));
      if (noteReview && method === "POST" && noteReview[2] !== "saved") {
        const [, itemId, action] = noteReview;
        if (action === "draft" || action === "refine") {
          if (body.agentId) return sendJson(res, 202, { job: await reportManager.startNote(itemId, action, body) });
          const draft = action === "refine" ? await agendaNotes.refine(fresh, itemId, body, chat) : await agendaNotes.draft(fresh, itemId, chat);
          const current = readStore(), item = agendaNotes.agenda(current, itemId);
          if (agendaNotes.signature(item) !== draft.sourceHash || agendaNotes.hash(JSON.stringify(agendaNotes.config(current))) !== draft.configHash) return sendJson(res, 409, { error: "复盘已变化，请重新生成摘要。" });
          agendaNotes.validateBaseNote(current, itemId, draft);
          return sendJson(res, 200, draft);
        }
        const cleanupPlan = body.removeOlderVersions === true ? agendaNoteCleanup.validatePlan(fresh, itemId, { snapshot: body.cleanupSnapshot }) : null;
        const saved = agendaNotes.save(fresh, itemId, body);
        const item = agendaNotes.agenda(fresh, itemId);
        item.reviewNote = { file: saved.note.file, path: saved.note.path, version: saved.note.version, sourceHash: body.sourceHash, savedAt: nowIso() };
        writeStore(fresh);
        if (cleanupPlan) {
          try {
            const preview = agendaNoteCleanup.plan(fresh, itemId), expectedOlder = saved.duplicate ? cleanupPlan.older : cleanupPlan.existing;
            if (preview.latest?.file !== saved.note.file || preview.latest.sha256 !== saved.note.sha256 || JSON.stringify(preview.older) !== JSON.stringify(expectedOlder)) throw new Error("笔记保存后版本已变化，旧文件未移除，请重新查看版本清单。");
            saved.cleanup = agendaNoteCleanup.moveOlder(fresh, itemId, preview);
          }
          catch (error) { saved.cleanup = { removedCount: 0, error: error.message }; }
        }
        return sendJson(res, 200, saved);
      }
      if (p === "/api/agenda-notes/suggest" && method === "POST") {
        const result = await agendaNotes.suggest(fresh, body, chat);
        const current = readStore(), files = agendaNotes.list(current).notes;
        if (agendaNotes.hash(JSON.stringify(agendaNotes.config(fresh))) !== agendaNotes.hash(JSON.stringify(agendaNotes.config(current)))) return sendJson(res, 409, { error: "笔记目录已变化，请重新获取建议。" });
        for (const source of result.sources) {
          const actual = files.find(note => note.file === source.file);
          if (!actual || actual.sha256 !== source.sha256 || actual.status !== "active" || files.some(note => note.agendaId === source.agendaId && note.version > source.version)) return sendJson(res, 409, { error: "笔记已变化，请重新获取建议。" });
        }
        return sendJson(res, 200, result);
      }
      if (noteFile && method === "PATCH") return sendJson(res, 200, agendaNotes.setStatus(fresh, decodeURIComponent(noteFile[1]), body));
      return sendJson(res, 405, { error: "method_not_allowed" });
    } catch (error) { return sendJson(res, error.status || 400, { error: error.message }); }
  }

  return [
    {
      path: (p) => p === "/api/agenda-notes/rename-preview" || p === "/api/agenda-notes/rename-apply",
      local: "agenda_notes_local_only",
      async handler({ req, res, p, method }) {
        try {
          const renaming = require("../lib/agenda-note-rename");
          if (p.endsWith("rename-preview") && method === "GET") return sendJson(res, 200, renaming.preview(readStore()));
          if (p.endsWith("rename-apply") && method === "POST") return sendJson(res, 200, renaming.apply({ readStore, writeStore, backupRoot: path.join(DATA, "backups", "agenda-note-renames") }, await readBody(req) || {}));
          return sendJson(res, 405, { error: "method_not_allowed" });
        } catch (error) { return sendJson(res, 409, { error: error.message }); }
      },
    },
    {
      path: (p) => ["/api/agenda-notes", "/api/agenda-notes/config", "/api/agenda-notes/suggest"].includes(p) || NOTE_REVIEW.test(p) || NOTE_FILE.test(p) || NOTE_RESTORE.test(p),
      local: "agenda_notes_local_only",
      handler: reviewNotes,
    },
    {
      method: "GET", path: "/api/agenda/reports/review-sources", local: "report_local_only",
      handler({ res, url }) {
        try {
          const profile = url.searchParams.get("profile"); if (profile && profile !== "thoughts-v1") throw Error("报告类型无效。");
          return sendJson(res, 200, require(profile === "thoughts-v1" ? "../lib/monthly-thought-report" : "../lib/saved-review-report").preview(readStore(), url.searchParams.get("anchorDate")));
        }
        catch (error) { return sendJson(res, 409, { error: error.message }); }
      },
    },
    {
      path: (p) => p === "/api/agenda/reports/draft" || p === "/api/agenda/reports/jobs" || REPORT_JOB.test(p),
      local: "report_local_only",
      async handler({ req, res, p, method, reportManager }) {
        const reportJobRoute = p.match(REPORT_JOB);
        try {
          if (method === "GET" && p === "/api/agenda/reports/jobs") return sendJson(res, 200, { jobs: (readStore().agendaReportJobs || []).map(j => reportManager.get(j.id)) });
          if (method === "POST" && p === "/api/agenda/reports/draft") return sendJson(res, 202, { job: reportManager.start(await readBody(req) || {}) });
          if (method === "GET" && reportJobRoute && !reportJobRoute[2]) return sendJson(res, 200, { job: reportManager.get(reportJobRoute[1]) });
          if (method === "POST" && reportJobRoute?.[2]) return sendJson(res, 200, { job: reportManager.action(reportJobRoute[1], reportJobRoute[2], await readBody(req) || {}) });
          return sendJson(res, 405, { error: "method_not_allowed" });
        } catch (err) { return sendJson(res, 409, { error: err.code || err.message }); }
      },
    },
    {
      path: (p) => EXPORT_PATHS.includes(p),
      local: "report_export_local_only",
      async handler({ req, res, p, method }) {
        try {
          if (method === "GET" && p.endsWith("/config")) return sendJson(res, 200, { directory: reportExport.directory(readStore()), folder: reportExport.FOLDER });
          if (method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
          const body = await readBody(req) || {}, fresh = readStore();
          if (p.endsWith("/preview")) return sendJson(res, 200, reportExport.preview(fresh, body));
          if (!p.endsWith("/save")) return sendJson(res, 405, { error: "method_not_allowed" });
          const exported = reportExport.save(fresh, body);
          try { writeStore(fresh); } catch (error) { return sendJson(res, 500, { error: "report_export_ledger_failed", message: "文件已写入，但台账登记失败；请保留草稿后重试。", file: exported.file }); }
          return sendJson(res, 200, { export: exported, report: fresh.reports.find(r => r.id === exported.reportId) });
        } catch (error) { return sendJson(res, 409, { error: error.code || "report_export_failed", message: error.message }); }
      },
    },
    { method: "GET", path: "/api/reminder/config", handler: ({ res, store }) => sendJson(res, 200, reminderPublicConfig(store)) },
    {
      method: "PUT", path: "/api/reminder/config",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        store.remote = store.remote || {};
        const previous = store.remote.reminder || {};
        const next = { ...previous };
        if (["pushplus", "serverchan"].includes(body.provider)) next.provider = body.provider;
        if (typeof body.enabled === "boolean") next.enabled = body.enabled;
        if (typeof body.token === "string" && body.token && body.token !== "__KEEP__") next.token = body.token;
        store.remote.reminder = next;
        writeStore(store);
        return sendJson(res, 200, reminderPublicConfig(store));
      },
    },
    {
      method: "POST", path: /^\/api\/agendas\/([^/]+)\/open-material$/,
      async handler({ req, res, store }, match) {
        const body = await readBody(req) || {};
        const result = await openAgendaMaterial(store, match[1], body.index);
        return sendJson(res, result.ok ? 200 : 404, result);
      },
    },
  ];
};

module.exports.reminderPublicConfig = reminderPublicConfig;
