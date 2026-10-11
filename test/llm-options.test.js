const assert = require("assert");
const { modelOptions } = require("../lib/llm");

assert.deepStrictEqual(modelOptions({ temperature: 0.4, maxTokens: 450 }), { temperature: 0.4, num_predict: 450 });
assert.deepStrictEqual(modelOptions({ temperature: 0 }), { temperature: 0 });
assert.deepStrictEqual(modelOptions({ maxTokens: -1 }), {});

console.log("LLM generation-limit checks passed.");
