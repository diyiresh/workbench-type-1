"use strict";

const { sendJson, readBody, notFound } = require("../lib/http");
const { id, nowIso } = require("../lib/default-store");
const { ymd } = require("../lib/migrate");
const { buildBriefings } = require("../lib/briefing");
const { ingestBrief, sourceSummaries } = require("../lib/brief-hub");

module.exports = function briefRoutes({ readStore, writeStore }) {
  return [
    {
      method: "GET", path: "/api/brief-runs",
      handler({ res, url, store }) {
        const sourceId = url.searchParams.get("sourceId") || "";
        const unread = url.searchParams.get("unread");
        const favorite = url.searchParams.get("favorite");
        let runs = (store.briefRuns || []).filter(run => !run.archived);
        if (sourceId) runs = runs.filter((item) => item.sourceId === sourceId);
        if (unread === "true") runs = runs.filter((item) => item.unread !== false);
        if (unread === "false") runs = runs.filter((item) => item.unread === false);
        if (favorite === "true") runs = runs.filter((item) => item.favorite === true);
        if (favorite === "false") runs = runs.filter((item) => item.favorite !== true);
        return sendJson(res, 200, { sources: sourceSummaries(store), runs });
      },
    },
    {
      method: "POST", path: (p) => p === "/api/brief-runs" || p === "/api/briefs/intake", local: "brief_intake_local_only",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        try {
          const result = ingestBrief(store, body, { id, nowIso });
          if (!result.duplicate) writeStore(store);
          return sendJson(res, result.duplicate ? 200 : 201, result);
        } catch (err) {
          return sendJson(res, 400, { error: String((err && err.message) || err) });
        }
      },
    },
    {
      method: "PATCH", path: /^\/api\/brief-runs\/([^/]+)$/,
      async handler({ req, res }, match) {
        const body = await readBody(req) || {};
        // Read after the request body: a parallel intake or archive must not be overwritten.
        const current = readStore();
        const run = (current.briefRuns || []).find((item) => item.id === match[1]);
        if (!run) return notFound(res);
        if (run.archived) return sendJson(res, 409, { error: "record_archived" });
        for (const field of ["unread", "favorite"]) {
          if (Object.hasOwn(body, field) && typeof body[field] !== "boolean") return sendJson(res, 400, { error: "invalid_brief_preferences" });
        }
        if (!Object.hasOwn(body, "unread") && !Object.hasOwn(body, "favorite")) return sendJson(res, 400, { error: "missing_brief_preferences" });
        if (typeof body.unread === "boolean") run.unread = body.unread;
        if (typeof body.favorite === "boolean") run.favorite = body.favorite;
        writeStore(current);
        return sendJson(res, 200, run);
      },
    },
    {
      method: "DELETE", path: /^\/api\/brief-runs\/([^/]+)$/, local: "brief_delete_local_only",
      handler({ res, store }, match) {
        const index = (store.briefRuns || []).findIndex((item) => item.id === match[1]);
        if (index < 0) return notFound(res);
        const [removed] = store.briefRuns.splice(index, 1);
        writeStore(store);
        return sendJson(res, 200, removed);
      },
    },
    { method: "GET", path: "/api/briefings", handler: ({ res, store }) => sendJson(res, 200, { dismissedOn: store.meta.briefingDismissedOn || "", items: buildBriefings(store) }) },
    {
      method: "POST", path: "/api/briefings/dismiss",
      handler({ res, store }) {
        store.meta.briefingDismissedOn = ymd();
        writeStore(store);
        return sendJson(res, 200, { dismissedOn: store.meta.briefingDismissedOn });
      },
    },
  ];
};
