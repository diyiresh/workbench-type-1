'use strict';
function isSiliconFlow(config = {}) {
  try { return /(^|\.)siliconflow\.(cn|com)$/.test(new URL(config.baseUrl).hostname.toLowerCase()); }
  catch { return false; }
}
function paused(store, config = store.remote?.llm || {}) {
  return isSiliconFlow(config) && store.remote?.providerPauses?.siliconflow?.paused === true;
}
function assertAllowed(store, config) {
  if (paused(store, config)) throw Object.assign(new Error('SiliconFlow 已暂停，配置已保留；请明确恢复后再调用。'), { code: 'provider_paused' });
}
function setPause(store, body) {
  if (body.provider !== 'siliconflow' || typeof body.paused !== 'boolean' || body.confirmed !== true) throw new Error('provider_pause_confirmation_required');
  store.remote ||= {};
  store.remote.providerPauses ||= {};
  const previous = store.remote.providerPauses.siliconflow || {};
  const config = store.remote.llm || {};
  const current = { ...previous, paused: body.paused, updatedAt: new Date().toISOString() };
  if (body.paused) {
    if (!previous.paused) current.wasEnabled = !!config.enabled;
    if (isSiliconFlow(config)) config.enabled = false;
  } else if (previous.paused && previous.wasEnabled && isSiliconFlow(config)) config.enabled = true;
  store.remote.providerPauses.siliconflow = current;
  return { provider: 'siliconflow', paused: current.paused };
}
module.exports = { isSiliconFlow, paused, assertAllowed, setPause };
