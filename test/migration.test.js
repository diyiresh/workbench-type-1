"use strict";

const assert = require("assert");
const { buildDefaultStore } = require("../lib/default-store");
const { ensureV2, ymd } = require("../lib/migrate");

const store = ensureV2(buildDefaultStore());
const today = ymd();
const current = store.plans.find((plan) => plan.start <= today && today <= plan.end);
assert(current, "迁移后必须存在当前周计划");
assert.equal(new Set(store.plans.map((plan) => plan.id)).size, store.plans.length, "默认周计划不能重复");
assert.equal(current.slots.find((slot) => slot.date === today).date, today);
assert.match(current.title, /本周安排/);
console.log("Current-week plan migration checks passed.");
