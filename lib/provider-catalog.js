'use strict';
const MODELS=['codex','cursor','workbuddy','deepseek','doubao','ollama'];
const EXTERNAL=MODELS.filter(id=>id!=='codex');
const names={codex:'ChatGPT Codex',cursor:'Cursor',workbuddy:'WorkBuddy',deepseek:'DeepSeek Harness',doubao:'豆包桌面',ollama:'Ollama（Docker）',docker:'Docker Desktop'};
function metadata(id){if(!names[id])return null;return {id,name:names[id],kind:id==='docker'?'infrastructure':'model',implemented:true,capabilities:id==='docker'?['model-host']:['project-stage','project-chat'],transport:({codex:'codex-cli',cursor:'external-cli',workbuddy:'desktop-scheduled',deepseek:'harness-cli',doubao:'desktop-manual',ollama:'ollama-http',docker:'docker-engine'})[id]};}
function snapshot(store,id){const m=metadata(id);if(!m)return null;const c=store.providerConnections?.[id]||{},probe=c.probe||{};const stale=probe.observedAt&&Date.now()-Date.parse(probe.observedAt)>75*60000;return {...m,...probe,state:stale?'unknown':probe.state||(id==='doubao'?'manual':'unknown'),reason:stale?'检测记录已过期，请重新检测。':probe.reason||(id==='doubao'?'桌面收发尚需人工接续；自动取回未验收。':'尚未检测实际通道。'),model:c.model||null,models:probe.models||[],testedAt:c.testedAt||null,testStatus:c.testStatus||null,lastJob:(store.providerJobs||[]).find(j=>j.id===c.lastJobId)||null};}
module.exports={MODELS,EXTERNAL,metadata,snapshot};
