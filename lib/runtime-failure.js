'use strict';
function kind(error) {
  const text=String(error.message||error);
  if (error.code==='auth_required'||/authentication required|not authenticated|please.*login/i.test(text)) return 'auth';
  if (/region|权限|permission denied|forbidden/i.test(text)) return 'permission';
  if (['result_identity_mismatch','input_changed','project_paused','project_paused_or_archived'].includes(error.code)) return 'control';
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|socket disconnected|network.*(error|fail)|TLS connection|fetch failed|connection.*(reset|closed)|stream disconnected/i.test(text)||error.code==='network_transient') return 'network';
  if (error.code==='output_format'||/未返回完整|未返回成果|未返回完整 JSON|JSON.*(parse|invalid)/i.test(text)) return 'format';
  return 'unknown';
}
function closed(error,evidence,partial='') {
  error.termination=evidence;
  error.failureKind=kind(error);
  if (partial) error.partialOutput=String(partial).slice(0,2000000);
  if (!error.code&&error.failureKind==='network')error.code='network_transient';
  if (!error.code&&error.failureKind==='format')error.code='output_format';
  return error;
}
function retryable(attempt,error) {
  return ['external-cli','codex-cli','harness-cli','ollama-http'].includes(attempt.transport)&&!!error.termination?.closedAt&&['network','format'].includes(error.failureKind||kind(error));
}
module.exports={kind,closed,retryable};
