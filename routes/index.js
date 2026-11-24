"use strict";

// Route manifest. Each module returns a list of { method?, path, local?, handler(ctx, match) }.
// ctx: { req, res, url, p, method, store, reportManager, paperManager, launchDeps }.
// Domains here own disjoint URL prefixes; department, inbox, task and generic record routes stay in server.js.
const MODULES = [
  require('./coordinator'),
  require("./provider-connections"),
  require("./skills"),
  require("./codex"),
  require("./superagent"),
  require("./agenda"),
  require("./briefs"),
  require("./models"),
  require("./life-learning"),
  require("./local-files"),
  require("./activity"),
];

module.exports = function buildRoutes(deps) {
  return MODULES.flatMap((factory) => factory(deps));
};
module.exports.MODULES = MODULES;
