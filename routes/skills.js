"use strict";

const { sendJson, readBody, isLoopback } = require("../lib/http");
const skillStudio = require("../lib/skill-studio");

// Disk skill catalog and the skill studio (docs/SPEC-skill-studio.md).
module.exports = function skillRoutes({ readStore, writeStore, diskCatalog, skillManager, SKILL_ROOT }) {
  return [
    {
      path: (p) => p === "/api/disk-skills" || p.startsWith("/api/disk-skills/"),
      async handler({ req, res, p, method }) {
        try {
          if (method === "GET" && p === "/api/disk-skills") return sendJson(res, 200, await diskCatalog.list());
          if (method === "POST" && p === "/api/disk-skills/rescan") {
            if (!isLoopback(req)) return sendJson(res, 403, { error: "disk_skill_local_only" });
            return sendJson(res, 200, await diskCatalog.rescan());
          }
          const match = p.match(/^\/api\/disk-skills\/([a-f0-9]{32})(?:\/(save|push))?$/);
          if (!match) return sendJson(res, 404, { error: "disk_skill_missing" });
          if (method === "GET" && !match[2]) return sendJson(res, 200, await diskCatalog.detail(match[1]));
          if (method !== "POST" || !match[2]) return sendJson(res, 405, { error: "disk_skill_method_not_allowed" });
          if (!isLoopback(req)) return sendJson(res, 403, { error: "disk_skill_local_only" });
          const body = await readBody(req) || {};
          const result = match[2] === "save" ? await diskCatalog.save(match[1], body) : await diskCatalog.push(match[1], body);
          return sendJson(res, 200, result);
        } catch (error) {
          const code = error.message === "disk_skill_missing" ? 404 : error.message === "disk_skill_local_only" ? 403 : 409;
          return sendJson(res, code, { error: error.message, detail: error.detail || "" });
        }
      },
    },
    {
      path: (p) => p === "/api/skill-library" || p.startsWith("/api/skill-library/"),
      async handler({ req, res, p, method, store }) {
        try {
          if (method === "GET" && p === "/api/skill-library") return sendJson(res, 200, { skills: (store.skillLibrary || []).map(s => ({ id: s.id, state: s.state, name: s.draft.name, description: s.draft.description, revision: s.revision, currentVersionId: s.currentVersionId, versions: s.versions.length, archived: !!s.archived })) });
          if (method === "GET" && p === "/api/skill-library/sources") return sendJson(res, 200, { sources: skillStudio.sources(store) });
          const match = p.match(/^\/api\/skill-library\/([^/]+)(?:\/(draft|publish|restore|state|cases|run|evaluate))?$/);
          if (method === "GET" && match && !match[2]) return sendJson(res, 200, skillStudio.detail(store, SKILL_ROOT, match[1]));
          if (method !== "POST") return sendJson(res, 405, { error: "skill_method_not_allowed" });
          if (!isLoopback(req)) return sendJson(res, 403, { error: "skill_local_only" });
          const body = await readBody(req) || {};
          const fresh = readStore();
          let result;
          if (p === "/api/skill-library") result = skillStudio.create(fresh, body);
          else if (match?.[2] === "run") return sendJson(res, 202, skillManager.start({ ...body, skillId: match[1] }));
          else if (match?.[2] === "evaluate") return sendJson(res, 200, skillManager.evaluate(match[1], body));
          else if (match?.[2]) result = skillStudio.mutate(fresh, SKILL_ROOT, match[1], match[2], body);
          else return sendJson(res, 404, { error: "skill_route_not_found" });
          if (!result.duplicate) writeStore(fresh);
          return sendJson(res, 200, result);
        } catch (error) { return sendJson(res, 409, { error: error.message }); }
      },
    },
  ];
};
