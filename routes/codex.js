"use strict";

const { sendJson, readBody } = require("../lib/http");
const codex = require("../lib/codex");

module.exports = function codexRoutes({ codexManager }) {
  return [
    { method: "GET", path: "/api/codex/status", handler: async ({ res }) => sendJson(res, 200, await codex.status()) },
    { method: "GET", path: "/api/codex/jobs", handler: ({ res, store }) => sendJson(res, 200, { jobs: store.codexJobs || [] }) },
    {
      method: "POST",
      path: "/api/codex/jobs",
      async handler({ req, res }) {
        const body = await readBody(req) || {};
        try { return sendJson(res, 202, { job: codexManager.start({ runId: body.runId, role: body.role, test: body.test === true, idempotencyKey: body.idempotencyKey }) }); }
        catch (err) { return sendJson(res, 409, { error: err.message }); }
      },
    },
  ];
};
