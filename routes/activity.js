"use strict";

const { sendJson } = require("../lib/http");
const { decisions, timeline } = require("../lib/activity");

// Read-only: computed on the request's private copy of the ledger, never written back.
module.exports = function activityRoutes() {
  return [
    { method: "GET", path: "/api/decisions", handler: ({ res, store }) => sendJson(res, 200, { decisions: decisions(store) }) },
    {
      method: "GET", path: /^\/api\/departments\/runs\/([^/]+)\/timeline$/,
      handler({ res, store }, match) {
        try { return sendJson(res, 200, timeline(store, decodeURIComponent(match[1]))); }
        catch (error) { return sendJson(res, error.status || 400, { error: error.message }); }
      },
    },
  ];
};
