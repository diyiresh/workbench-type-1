"use strict";

const { sendJson, readBody, isLoopback } = require("../lib/http");
const externalTools = require("../lib/external-tools");
const { openInExplorer } = require("../lib/local-opener");

// Paper library and external tool launcher: both touch local files or programs, so writes stay on this machine.
module.exports = function localFileRoutes({ DATA }) {
  return [
    {
      path: (p) => p === "/api/papers" || p.startsWith("/api/papers/"),
      async handler({ req, res, p, method, paperManager }) {
        try {
          if (!isLoopback(req)) return sendJson(res, 403, { error: "paper_library_local_only" });
          const origin = req.headers.origin;
          if (req.headers["sec-fetch-site"] === "cross-site" || (origin && origin !== `http://${req.headers.host}`)) return sendJson(res, 403, { error: "paper_library_origin_rejected" });
          if (method === "GET" && p === "/api/papers") return sendJson(res, 200, paperManager.list());
          if (method === "POST" && p === "/api/papers/import") return sendJson(res, 200, await paperManager.import());
          const match = p.match(/^\/api\/papers\/(paper-[a-f0-9]{24})(?:\/(download|file|folder))?$/);
          if (!match) return sendJson(res, 404, { error: "paper_route_not_found" });
          const [, paperId, action] = match;
          if (method === "PATCH" && !action) return sendJson(res, 200, paperManager.patch(paperId, await readBody(req)));
          if (method === "POST" && action === "download") return sendJson(res, 202, paperManager.download(paperId));
          if (method === "GET" && action === "file") {
            const file = paperManager.file(paperId);
            res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": file.bytes.length, "Content-Disposition": `inline; filename="${paperId}.pdf"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
            return res.end(file.bytes);
          }
          if (method === "POST" && action === "folder") {
            const file = paperManager.file(paperId); await openInExplorer(file.file, false); return sendJson(res, 200, { opened: true });
          }
          return sendJson(res, 405, { error: "paper_method_not_allowed" });
        } catch (error) { return sendJson(res, error.status || 400, { error: error.message }); }
      },
    },
    {
      path: (p) => p === "/api/external-tools" || p.startsWith("/api/external-tools/"),
      async handler({ req, res, p, method, launchDeps }) {
        try {
          if (method === "GET" && p === "/api/external-tools") return sendJson(res, 200, externalTools.loadCatalog(DATA));
          if (!isLoopback(req)) return sendJson(res, 403, { error: "external_tools_local_only" });
          if (method === "POST" && p === "/api/external-tools") return sendJson(res, 200, externalTools.saveTool(DATA, await readBody(req) || {}));
          const toolLaunch = p.match(/^\/api\/external-tools\/([^/]+)\/launch$/);
          if (toolLaunch && method === "POST") {
            const body = await readBody(req) || {};
            return sendJson(res, 200, await externalTools.launch(DATA, decodeURIComponent(toolLaunch[1]), String(body.actionId || ""), launchDeps));
          }
          const toolItem = p.match(/^\/api\/external-tools\/([^/]+)$/);
          if (toolItem && method === "DELETE") {
            const body = await readBody(req) || {};
            return sendJson(res, 200, externalTools.removeTool(DATA, decodeURIComponent(toolItem[1]), body.expectedRevision));
          }
          return sendJson(res, 405, { error: "external_tools_method_not_allowed" });
        } catch (error) {
          return sendJson(res, error.status || 400, { error: error.message });
        }
      },
    },
  ];
};
