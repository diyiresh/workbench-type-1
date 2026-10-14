"use strict";
const vault = require('./vault');

// 模型路由：本地 Ollama 或任意 OpenAI 兼容在线接口（DeepSeek 等）。
// 密钥只存本机 data/store.json，不进任何仓库。
// 配置位置：store.remote.llm = { provider, baseUrl, model, apiKey, enabled }

function modelOptions({ temperature, maxTokens } = {}) {
  const options = {};
  if (Number.isFinite(temperature)) options.temperature = temperature;
  if (Number.isFinite(maxTokens) && maxTokens > 0) options.num_predict = Math.floor(maxTokens);
  return options;
}

async function chat(store, { system, prompt, messages, timeoutMs = 90000, temperature = 0.3, maxTokens, useVault = true, vaultQuery, onEvidence, requireComplete = false } = {}) {
  const cfg = (store.remote && store.remote.llm) || {};
  if (!cfg.enabled) throw new Error("模型路由未启用：请到「设置」配置并勾选启用。");

  const msgs = [];
  if (system) msgs.push({ role: "system", content: String(system) });
  if (Array.isArray(messages)) msgs.push(...messages);
  else msgs.push({ role: "user", content: String(prompt || "") });
  if (useVault && vault.config(store).enabled) {
    const query = vaultQuery || prompt || [...msgs].reverse().find(m => m.role === 'user')?.content;
    const evidence = await vault.prepareEvidence(store, query);
    msgs.push({ role: 'user', content: vault.evidenceBlock(evidence) });
    if (onEvidence) onEvidence(vault.provenance(evidence));
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    if (cfg.provider === "openai") {
      const base = (cfg.baseUrl || "https://api.deepseek.com").replace(/\/$/, "");
      const res = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + (cfg.apiKey || ""),
        },
        body: JSON.stringify({ model: cfg.model || "deepseek-chat", messages: msgs, stream: false, temperature, ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { max_tokens: Math.floor(maxTokens) } : {}) }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("在线模型返回 " + res.status + ": " + (await res.text()).slice(0, 300));
      const data = await res.json();
      if (requireComplete && data.choices?.[0]?.finish_reason === 'length') throw new Error('模型输出达到长度限制，未更新草稿，请缩短内容后重试。');
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    }
    // 默认：本地 Ollama
    const base = (cfg.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
    const res = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model || "qwen2.5:7b", messages: msgs, stream: false, options: modelOptions({ temperature, maxTokens }) }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error("Ollama 返回 " + res.status + "（请确认已 ollama serve，且模型名正确）");
    const data = await res.json();
    if (requireComplete && data.done_reason === 'length') throw new Error('模型输出达到长度限制，未更新草稿，请缩短内容后重试。');
    return (data.message && data.message.content) || "";
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chat, modelOptions };
