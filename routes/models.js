"use strict";

const fs = require("fs");
const path = require("path");
const { sendJson, readBody, isLoopback, notFound } = require("../lib/http");
const { nowIso } = require("../lib/default-store");
const { chat } = require("../lib/llm");
const vault = require("../lib/vault");
const providerPolicy = require("../lib/provider-policy");
const { onlineCompatibleStatus } = require("../lib/model-status");

async function ollamaStatus(store) {
  const cfg = (store.remote && store.remote.llm) || {};
  if (cfg.provider === "openai") return onlineCompatibleStatus(cfg, { paused: providerPolicy.paused(store, cfg) });
  const baseUrl = (cfg.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const [versionRes, tagsRes] = await Promise.all([
      fetch(baseUrl + "/api/version", { signal: ctrl.signal }),
      fetch(baseUrl + "/api/tags", { signal: ctrl.signal }),
    ]);
    if (!versionRes.ok || !tagsRes.ok) throw new Error("服务返回 " + versionRes.status + "/" + tagsRes.status);
    const version = await versionRes.json();
    const tags = await tagsRes.json();
    return {
      ok: true,
      baseUrl,
      version: version.version || "",
      models: (tags.models || []).map((m) => ({ name: m.name, size: m.size, modifiedAt: m.modified_at })),
    };
  } catch (err) {
    return { ok: false, baseUrl, error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

// Obsidian vault index service and the model route (local Ollama / OpenAI-compatible online).
module.exports = function modelRoutes({ readStore, writeStore }) {
  return [
    { method: "GET", path: "/api/vault/config", handler: ({ res, store }) => sendJson(res, 200, vault.config(store)) },
    {
      method: "PUT", path: "/api/vault/config",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        const next = { ...vault.config(store), enabled: Boolean(body.enabled), baseUrl: vault.localUrl(body.baseUrl), keyFile: String(body.keyFile || ""), vaultId: String(body.vaultId || vault.config(store).vaultId || "") };
        if (next.enabled && (!path.isAbsolute(next.keyFile) || !fs.existsSync(next.keyFile))) return sendJson(res, 400, { error: "资料库凭据文件不存在。" });
        store.remote ||= {}; store.remote.vault = next; writeStore(store);
        return sendJson(res, 200, { ok: true });
      },
    },
    { method: "GET", path: "/api/vault/status", handler: async ({ res, store }) => sendJson(res, 200, await vault.request(store, "/v1/status")) },
    { method: "GET", path: "/api/vault/files", handler: async ({ res, url, store }) => sendJson(res, 200, await vault.request(store, "/v1/files?status=" + encodeURIComponent(url.searchParams.get("status") || "") + "&limit=100")) },
    { method: "POST", path: "/api/vault/sync", handler: async ({ res, store }) => sendJson(res, 202, await vault.request(store, "/v1/sync", {})) },
    {
      method: "POST", path: "/api/vault/search",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        const evidence = await vault.request(store, "/v1/search", { query: body.query, k: 5, mode: body.mode || "hybrid", client: "workbench" });
        const fresh = readStore(); fresh.remote.vault.lastRetrieval = vault.provenance(evidence); writeStore(fresh);
        return sendJson(res, 200, evidence);
      },
    },
    {
      method: "GET", path: "/api/llm/config",
      handler({ res, store }) {
        const cfg = { ...((store.remote && store.remote.llm) || {}) };
        cfg.hasKey = Boolean(cfg.apiKey);
        delete cfg.apiKey; // 密钥不回传前端，只回传是否已设置
        cfg.siliconflowPaused = !!store.remote?.providerPauses?.siliconflow?.paused;
        return sendJson(res, 200, cfg);
      },
    },
    { method: "GET", path: "/api/llm/status", handler: async ({ res, store }) => sendJson(res, 200, await ollamaStatus(store)) },
    {
      method: "PUT", path: "/api/llm/config",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        store.remote = store.remote || {};
        const prevKey = (store.remote.llm && store.remote.llm.apiKey) || "";
        const next = { ...(store.remote.llm || {}), ...body };
        if (!body.apiKey || body.apiKey === "__KEEP__") next.apiKey = prevKey;
        delete next.siliconflowPaused;
        if (providerPolicy.paused(store, next)) next.enabled = false;
        store.remote.llm = next;
        writeStore(store);
        return sendJson(res, 200, { ok: true, hasKey: Boolean(next.apiKey) });
      },
    },
    {
      path: "/api/llm/provider-pause",
      async handler({ req, res, method, store }) {
        if (!isLoopback(req)) return sendJson(res, 403, { error: "provider_pause_local_only" });
        if (method === "GET") return sendJson(res, 200, { provider: "siliconflow", paused: !!store.remote?.providerPauses?.siliconflow?.paused });
        if (method !== "POST") return notFound(res);
        try { const body = await readBody(req) || {}, fresh = readStore(); const result = providerPolicy.setPause(fresh, body); writeStore(fresh); return sendJson(res, 200, result); }
        catch (error) { return sendJson(res, 400, { error: error.message }); }
      },
    },
    {
      method: "POST", path: "/api/llm/test",
      async handler({ res, store }) {
        try {
          const text = await chat(store, { prompt: "收到请只回复四个字：连接成功", useVault: false });
          store.remote.llm.lastTest = { ok: true, at: nowIso() };
          writeStore(store);
          return sendJson(res, 200, { ok: true, text: String(text).slice(0, 200) });
        } catch (err) {
          store.remote.llm.lastTest = { ok: false, at: nowIso() };
          writeStore(store);
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
        }
      },
    },
    {
      method: "POST", path: "/api/llm/generate",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        if (!body.prompt && !Array.isArray(body.messages)) return sendJson(res, 400, { error: "need_prompt" });
        try {
          let evidence;
          const text = await chat(store, { system: body.system, prompt: body.prompt, messages: body.messages, vaultQuery: body.vaultQuery, onEvidence: data => { evidence = data; } });
          if (evidence) { const fresh = readStore(); fresh.remote.vault.lastRetrieval = evidence; writeStore(fresh); }
          return sendJson(res, 200, { text, evidence });
        } catch (err) {
          return sendJson(res, 500, { error: String((err && err.message) || err) });
        }
      },
    },
  ];
};
