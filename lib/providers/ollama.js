'use strict';
const gov=require('../execution-governance'),failure=require('../runtime-failure');
function base(value='http://127.0.0.1:11434'){const u=new URL(value);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw gov.error('invalid_local_provider_url');return u.origin;}
async function status({config={},fetchImpl=fetch}={}){try{const origin=base(config.baseUrl);const r=await fetchImpl(origin+'/api/tags',{redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Ollama HTTP '+r.status);const data=await r.json();let models=[];for(const m of (data.models||[])){try{const show=await fetchImpl(origin+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:m.name}),redirect:'error',signal:AbortSignal.timeout(5000)});const info=await show.json();if(show.ok&&(info.capabilities||[]).includes('completion'))models.push(m.name);}catch{}}return {state:models.includes(config.model)?'ready':'unconfigured',reason:models.includes(config.model)?'本机模型接口在线，已选择模型；实际调用以测试记录为准。':models.length?'接口在线，请选择已安装的生成模型。':'接口在线，但未发现支持生成文字的已安装模型。',models};}catch(e){return {state:'offline',reason:'Ollama 接口不可用，请启动 Docker 和现有 Ollama 容器。',models:[]};}}
async function generate(prompt,cwd,context={},options={}){
 const config=options.config||{},origin=base(config.baseUrl),model=config.model;if(!model)throw gov.error('provider_unconfigured','请选择已安装的 Ollama 模型。');
 const maxTokens=options.maxTokens||8192;const required=Math.ceil(Buffer.byteLength(prompt,'utf8')/2)+maxTokens+512;
 const numCtx=Math.max(4096,2**Math.ceil(Math.log2(required)));if(numCtx>32768)throw gov.error('context_too_large','材料超出本地模型本轮上下文预算，请分段处理或换用长上下文成员。');
 context.onBeforeStart?.();context.onStart?.({source:'local-http-request',model});
 const fetchImpl=options.fetchImpl||fetch;let ended;
 // Existing Qwen3 templates can ignore think:false and leak reasoning into content.
 // Preserve the server's thinking parser and accept only its separate final content.
 try{const r=await fetchImpl(origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(options.timeoutMs||600000),body:JSON.stringify({model,messages:[{role:'system',content:'你是工作台文字任务成员。只能分析给定文字，不能访问本机文件或执行命令。说明证据缺口，不能声称做过未发生的检查。'},{role:'user',content:prompt}],stream:false,think:/^qwen3(?::|-)/i.test(model),options:{temperature:0.2,num_predict:maxTokens,num_ctx:numCtx},keep_alive:'5m'})});
 ended={closedAt:new Date().toISOString(),source:'http-response',status:r.status};context.onClose?.(ended);
 if(!r.ok)throw gov.error(r.status===404?'provider_unconfigured':'runtime_unavailable','Ollama 返回 HTTP '+r.status);
 const data=await r.json();if(data.done!==true||data.done_reason==='length')throw gov.error('output_format','Ollama 输出未完整结束，未采纳截断正文。');
 const text=String(data.message?.content||'').trim();if(!text)throw gov.error('output_format','Ollama 未返回完整正文。');return text;
 }catch(e){if(ended)throw failure.closed(e,ended);if(e.name==='TimeoutError'||e.name==='AbortError')throw gov.error('result_uncertain','Ollama 请求超时；服务端是否仍生成尚待核对。');const end={closedAt:new Date().toISOString(),source:'http-connect-failure'};context.onClose?.(end);throw failure.closed(e,end);}
}
module.exports={base,status,generate};
