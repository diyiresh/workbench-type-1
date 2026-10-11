const assert = require("assert");
const { onlineCompatibleStatus } = require("../lib/model-status");

const online = onlineCompatibleStatus({
  provider: "openai",
  enabled: true,
  apiKey: "local-only-secret",
  baseUrl: "https://api.siliconflow.cn/v1/",
  model: "deepseek-ai/DeepSeek-V4-Flash",
});
assert.strictEqual(online.ok, true);
assert.strictEqual(online.provider, "openai");
assert.strictEqual(online.baseUrl, "https://api.siliconflow.cn/v1");
assert.strictEqual("models" in online, false, "在线兼容接口不得执行 Ollama 模型列表探测");
assert.match(online.message, /测试连接/);

console.log("Online-compatible model status checks passed.");
