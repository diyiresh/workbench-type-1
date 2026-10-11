"use strict";

// 在线 OpenAI 兼容服务没有 Ollama 的 /api/version、/api/tags 协议。
// 它们的连通性由实际的 /api/llm/test 调用验证；状态卡只描述本机配置。
function onlineCompatibleStatus(config = {}) {
  const baseUrl = String(config.baseUrl || "").replace(/\/$/, "");
  const enabled = Boolean(config.enabled);
  const hasKey = Boolean(config.apiKey);
  const lastTest = config.lastTest && typeof config.lastTest === "object" ? config.lastTest : null;
  return {
    ok: enabled && hasKey,
    provider: "openai",
    baseUrl,
    model: String(config.model || ""),
    configured: enabled && hasKey,
    lastTest,
    message: enabled && hasKey ? "在线 OpenAI 兼容接口已配置；请通过“测试连接”进行实际验证。" : "请填写 API Key 并启用模型路由。",
  };
}

module.exports = { onlineCompatibleStatus };
