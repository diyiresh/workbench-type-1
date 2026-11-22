"use strict";

const { sendJson, isLoopback } = require("./http");

// A route is { method?, path, local?, handler(ctx, match) }.
// path: exact string, RegExp, or predicate(pathname). method: string or array; omitted = any.
// local: error code returned with 403 when the request is not from this machine.
function matches(route, ctx) {
  if (route.method) {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.includes(ctx.method)) return null;
  }
  if (typeof route.path === "string") return route.path === ctx.p ? [ctx.p] : null;
  if (route.path instanceof RegExp) return ctx.p.match(route.path);
  if (typeof route.path === "function") return route.path(ctx.p) ? [ctx.p] : null;
  return null;
}

function createRouter(routes) {
  return async function dispatch(ctx) {
    for (const route of routes) {
      const match = matches(route, ctx);
      if (!match) continue;
      if (route.local && !isLoopback(ctx.req)) {
        sendJson(ctx.res, 403, { error: route.local });
        return true;
      }
      await route.handler(ctx, match);
      return true;
    }
    return false;
  };
}

module.exports = { createRouter };
