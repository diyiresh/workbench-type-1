"use strict";

const assert = require("assert");
const { createRouter } = require("../lib/router");
const buildRoutes = require("../routes");

function fakeRes() {
  return {
    code: 0, body: null,
    writeHead(code) { this.code = code; },
    end(payload) { this.body = payload ? JSON.parse(String(payload)) : null; },
  };
}
const req = (address) => ({ socket: { remoteAddress: address }, headers: {} });

(async () => {
  const calls = [];
  const dispatch = createRouter([
    { method: "GET", path: "/api/a", handler: () => calls.push("exact") },
    { method: ["POST", "PUT"], path: /^\/api\/b\/([^/]+)$/, handler: (ctx, m) => calls.push("regex:" + m[1]) },
    { path: (p) => p.startsWith("/api/c/"), local: "c_local_only", handler: () => calls.push("prefix") },
  ]);

  assert.strictEqual(await dispatch({ req: req("127.0.0.1"), res: fakeRes(), p: "/api/a", method: "GET" }), true);
  assert.strictEqual(await dispatch({ req: req("127.0.0.1"), res: fakeRes(), p: "/api/a", method: "POST" }), false, "method must match");
  assert.strictEqual(await dispatch({ req: req("127.0.0.1"), res: fakeRes(), p: "/api/b/x1", method: "PUT" }), true);
  assert.strictEqual(await dispatch({ req: req("127.0.0.1"), res: fakeRes(), p: "/api/b/x1/y", method: "PUT" }), false);
  assert.strictEqual(await dispatch({ req: req("::1"), res: fakeRes(), p: "/api/c/z", method: "DELETE" }), true);

  const remote = fakeRes();
  assert.strictEqual(await dispatch({ req: req("192.168.1.9"), res: remote, p: "/api/c/z", method: "GET" }), true);
  assert.deepStrictEqual([remote.code, remote.body], [403, { error: "c_local_only" }], "local routes reject LAN callers before the handler runs");
  assert.deepStrictEqual(calls, ["exact", "regex:x1", "prefix"]);

  // The manifest builds without touching disk, and every route has a matcher and a handler.
  const routes = buildRoutes({ readStore: () => ({}), writeStore: () => {}, DATA: ".", SKILL_ROOT: ".", diskCatalog: {}, skillManager: {}, codexManager: {} });
  assert.ok(routes.length > 40, "domain routes registered");
  for (const route of routes) {
    assert.ok(["string", "function"].includes(typeof route.path) || route.path instanceof RegExp, "route path");
    assert.strictEqual(typeof route.handler, "function");
  }
  console.log(`Router dispatch, method/regex/prefix matching, local-only guard and ${routes.length}-route manifest passed.`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
