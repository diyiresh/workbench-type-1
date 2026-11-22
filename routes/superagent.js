"use strict";

const { sendJson, readBody } = require("../lib/http");
const superagentIntake = require("../lib/superagent-intake");
const superagentWatchdog = require("../lib/superagent-watchdog");
const superagentModel = require("../lib/superagent-model");
const superagentAsync = require("../lib/superagent-async");

const ASYNC_RUN = /^\/api\/superagent\/async\/([^/]+)(?:\/(stop|heartbeat|complete))?$/;

// Super-agent Phase1+2: intake, subscriptions, direct fan-out, async start/stop, watchdog
module.exports = function superagentRoutes({ readStore, writeStore }) {
  // Read-modify-write on a fresh store; errors become 400 like the original handlers.
  const mutate = (status, fn) => async ({ req, res }, match) => {
    try {
      const body = await readBody(req) || {};
      const fresh = readStore();
      const result = fn(fresh, body, match);
      writeStore(fresh);
      return sendJson(res, typeof status === "function" ? status(result) : status, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  };
  const asyncId = (match) => decodeURIComponent(match[1]);

  return [
    {
      method: "GET",
      path: "/api/superagent/config",
      handler({ res, store }) {
        const sa = superagentIntake.ensureSuperagent(store);
        return sendJson(res, 200, {
          intake: sa.intake,
          channels: sa.channels,
          watchdog: sa.watchdog,
          subscriptionCount: (sa.subscriptions || []).length,
          asyncRunCount: (sa.asyncRuns || []).length,
          aliases: superagentModel.describeAssignmentAlias(store),
        });
      },
    },
    { method: "GET", path: "/api/superagent/subscriptions", handler: ({ res, store }) => sendJson(res, 200, { subscriptions: superagentIntake.listSubscriptions(store) }) },
    {
      method: "POST", path: "/api/superagent/subscriptions", local: "superagent_subscriptions_local_only",
      handler: mutate(200, (fresh, body) => ({ subscription: superagentIntake.upsertSubscription(fresh, body) })),
    },
    {
      method: "DELETE", path: /^\/api\/superagent\/subscriptions\/([^/]+)$/, local: "superagent_subscriptions_local_only",
      handler({ res }, match) {
        const fresh = readStore();
        const result = superagentIntake.removeSubscription(fresh, decodeURIComponent(match[1]));
        writeStore(fresh);
        return sendJson(res, 200, result);
      },
    },
    {
      method: "POST", path: "/api/superagent/filter/preview",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        return sendJson(res, 200, superagentIntake.filterTrigger(store, body.trigger || body));
      },
    },
    {
      method: "POST", path: "/api/superagent/fanout/preview",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        const event = body.event || body;
        return sendJson(res, 200, superagentIntake.deliverFanOut(store, event, { dryRun: true, idempotencyKey: body.idempotencyKey || null }));
      },
    },
    {
      method: "POST", path: "/api/superagent/fanout/deliver", local: "superagent_fanout_local_only",
      handler: mutate(200, (fresh, body) => superagentIntake.deliverFanOut(fresh, body.event || body, {
        dryRun: false,
        idempotencyKey: body.idempotencyKey || null,
        bypassPause: body.bypassPause === true,
      })),
    },
    {
      method: "POST", path: "/api/superagent/ingest", local: "superagent_ingest_local_only",
      handler: mutate(200, (fresh, body) => superagentIntake.ingestAndDeliver(fresh, body.event || body.trigger || body, {
        forceDeliver: body.forceDeliver === true,
        idempotencyKey: body.idempotencyKey || null,
        bypassPause: body.bypassPause === true,
      })),
    },
    {
      method: "GET", path: "/api/superagent/async",
      handler: ({ res, url, store }) => sendJson(res, 200, { runs: superagentAsync.listAsyncRuns(store, { status: url.searchParams.get("status") || null }) }),
    },
    {
      method: "POST", path: "/api/superagent/async/start", local: "superagent_async_local_only",
      handler: mutate((result) => (result.duplicate ? 200 : 201), (fresh, body) => superagentAsync.startAsync(fresh, body)),
    },
    {
      method: "GET", path: (p) => { const m = p.match(ASYNC_RUN); return Boolean(m && !m[2]); },
      handler({ res, p, store }) {
        try {
          return sendJson(res, 200, { run: superagentAsync.getAsyncRun(store, asyncId(p.match(ASYNC_RUN))) });
        } catch (err) {
          return sendJson(res, 404, { error: err.message });
        }
      },
    },
    {
      method: "POST", path: /^\/api\/superagent\/async\/([^/]+)\/stop$/, local: "superagent_async_local_only",
      handler: mutate(200, (fresh, body, match) => superagentAsync.stopAsync(fresh, asyncId(match), {
        confirmed: body.confirmed === true,
        reason: body.reason || "cooperative_stop",
      })),
    },
    {
      method: "POST", path: /^\/api\/superagent\/async\/([^/]+)\/heartbeat$/, local: "superagent_async_local_only",
      handler: mutate(200, (fresh, body, match) => superagentAsync.heartbeatAsync(fresh, asyncId(match), body)),
    },
    {
      method: "POST", path: /^\/api\/superagent\/async\/([^/]+)\/complete$/, local: "superagent_async_local_only",
      handler: mutate(200, (fresh, body, match) => superagentAsync.completeAsync(fresh, asyncId(match), body)),
    },
    { method: "GET", path: "/api/superagent/watchdog/scan", handler: ({ res, store }) => sendJson(res, 200, superagentWatchdog.scan(store)) },
    {
      method: "POST", path: "/api/superagent/watchdog/apply", local: "superagent_watchdog_local_only",
      handler: mutate(200, (fresh, body) => {
        const scanned = superagentWatchdog.scan(fresh);
        const applied = superagentWatchdog.applySafePauses(fresh, scanned, {
          confirmed: body.confirmed === true,
          attemptIds: Array.isArray(body.attemptIds) ? body.attemptIds : null,
        });
        return { scanned, applied };
      }),
    },
  ];
};
