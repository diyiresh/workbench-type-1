'use strict';
const fs = require('fs');
const path = require('path');
const { inactive } = require('./archive');

// Read a single scheduler record, never its prompt, account, or credentials.
function workbuddyAutomation(file = path.join(require('os').homedir(), '.workbuddy', 'workbuddy.db')) {
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    if (!fs.existsSync(file)) return null;
    db = new DatabaseSync(file, { readOnly:true });
    const rows = db.prepare("SELECT status,updated_at FROM automations WHERE deleted_at IS NULL AND prompt LIKE '%workbuddy-queue.js%'").all();
    // Multiple registrations must be inspected explicitly rather than guessing which wins.
    if (rows.length !== 1) return null;
    return { state:rows[0].status === 'PAUSED' ? 'paused' : 'unknown', updatedAt:new Date(rows[0].updated_at).toISOString(), source:'workbuddy-automation' };
  } catch { return null; } finally { try { db?.close(); } catch {} }
}

function snapshot(store, { dataDir, automation = null, now = Date.now() } = {}) {
  let heartbeat = null;
  try { heartbeat = JSON.parse(fs.readFileSync(path.join(dataDir, 'workbuddy-queue', 'heartbeat.json'), 'utf8')); } catch {}
  const checked = Date.parse(heartbeat?.checkedAt);
  const fresh = Number.isFinite(checked) && now >= checked && now - checked < 75 * 60000;
  const agents = (store.agents || []).filter(a => !a.archived).map(a => {
    const jobs = [...(store.externalJobs || []), ...(store.codexJobs || []), ...(store.chatJobs || [])]
      .filter(j => !inactive(j) && (j.agentId === a.id || (a.id === 'codex' && (store.codexJobs || []).includes(j)))).sort((x,y) => String(y.createdAt).localeCompare(String(x.createdAt)));
    const scheduled = a.id === 'workbuddy';
    return {
      providerId:a.id, agentId:a.id, registration:inactive(a) ? 'paused' : a.status,
      status:['workbuddy','cursor','codex'].includes(a.id) ? 'implemented' : 'reserved',
      transport:scheduled ? 'desktop-scheduled' : a.id === 'cursor' ? 'external-cli' : a.id === 'codex' ? 'codex-cli' : null,
      capabilities:['workbuddy','cursor','codex'].includes(a.id) ? ['project-stage','project-chat'] : [],
      state:inactive(a) || (scheduled && automation?.state === 'paused') ? 'paused' : scheduled && heartbeat ? (fresh ? 'heartbeat-fresh' : 'stale') : 'unknown',
      observedAt:scheduled ? (automation?.state === 'paused' ? automation.updatedAt : heartbeat?.checkedAt || null) : null,
      evidence:scheduled ? (automation?.state === 'paused' ? automation.source : heartbeat ? 'queue-heartbeat' : null) : null,
      heartbeatAt:scheduled ? heartbeat?.checkedAt || null : null,
      lastAttempt:jobs[0] ? { id:jobs[0].id, status:jobs[0].status, createdAt:jobs[0].createdAt } : null,
    };
  });
  return {
    version:1, checkedAt:new Date(now).toISOString(), agents,
    extensions:[
      { id:'workbench', status:'implemented', capabilities:['project-stage','project-chat','ledger-assets','knowledge-retrieval'] },
      { id:'evoflow', status:'reserved', capabilities:['dependency-workflow','knowledge-assets'] },
      { id:'multica', status:'reserved', capabilities:['runtime-adapter','skill-discovery'] },
    ],
    contracts:{ runtime:1, workflow:1, skillLifecycle:1, knowledgeSource:1 },
    skillLifecycle:{ status:'reserved', stages:['experience','draft','confirmed','published','usage-receipt'] },
    knowledgeSources:[
      { sourceId:'vaultrag', kind:'vault', retrievalPolicy:'configured-vault', availability:store.remote?.vault?.enabled ? 'unknown' : 'unavailable' },
      { sourceId:'agenda-reviews', kind:'review-notes', retrievalPolicy:'direct-latest-active', useVault:false, availability:'unknown' },
    ],
  };
}
module.exports = { snapshot, workbuddyAutomation };
