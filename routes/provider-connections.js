'use strict';
const path=require('path'),{sendJson,readBody}=require('../lib/http'),commands=require('../lib/execution-commands'),gov=require('../lib/execution-governance'),desktop=require('../lib/providers/doubao');
module.exports=function({readStore,writeStore,DATA,providerManager}){return [{path:p=>p==='/api/providers'||p.startsWith('/api/providers/'),local:'provider_local_only',async handler({req,res,p,method}){try{
 if(method==='GET'&&p==='/api/providers')return sendJson(res,200,providerManager.list());
 let m=p.match(/^\/api\/providers\/jobs\/([^/]+)$/);if(method==='GET'&&m)return sendJson(res,200,providerManager.job(m[1]));
 const dir=path.join(DATA,'doubao-queue');if(method==='GET'&&p==='/api/providers/doubao/tasks')return sendJson(res,200,{tasks:desktop.tasks(readStore(),dir)});
 if(method!=='POST')return sendJson(res,405,{error:'method_not_allowed'});
 const body=await readBody(req)||{},scope=p;let store=readStore();const old=commands.receipt(store,scope,body);
 m=p.match(/^\/api\/providers\/doubao\/tasks\/([^/]+)\/(claim|submit)$/);if(m){let result;if(m[2]==='claim'){
  if(old){const a=gov.get(store,old.attemptId);gov.check(store,a);if(!['claimed','running'].includes(a.state))throw gov.error('reconcile_required');desktop.writeClaim(dir,m[1],old);return sendJson(res,200,old);}
  result=desktop.claim(store,dir,m[1],body);commands.remember(store,scope,body,result);writeStore(store);desktop.writeClaim(dir,m[1],result);
 }else{if(old)return sendJson(res,200,old);result=desktop.submit(store,dir,m[1],body);commands.remember(store,scope,body,result);writeStore(store);}return sendJson(res,200,result);}
 if(old)return sendJson(res,200,old);
 m=p.match(/^\/api\/providers\/(codex|cursor|workbuddy|deepseek|ollama|doubao|docker)\/(probe|test|configure)$/);if(!m)return sendJson(res,404,{error:'provider_route_missing'});
 let result;if(m[2]==='probe')result=await providerManager.probe(m[1]);else if(m[2]==='configure'&&m[1]==='ollama')result=await providerManager.configureModel(body);else if(m[2]==='test')result=providerManager.test(m[1],body);else throw gov.error('provider_route_missing');
 store=readStore();commands.remember(store,scope,body,result);writeStore(store);return sendJson(res,200,result);
 }catch(e){return sendJson(res,409,{error:e.code||e.message});}}}];};
