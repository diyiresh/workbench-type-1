const assert=require('node:assert/strict');
const {configureNetwork,proxyOptions}=require('../lib/network');
(async()=>{
  let applied;
  await configureNetwork({readEnvironment:async()=>({HTTPS_PROXY:'http://127.0.0.1:7897',NO_PROXY:'internal.example',SECRET:'do-not-copy'}),apply:p=>{applied=p;}});
  assert.equal(applied.HTTPS_PROXY,'http://127.0.0.1:7897');assert.equal(applied.SECRET,undefined);
  for(const name of ['localhost','127.0.0.1','::1','internal.example'])assert(applied.NO_PROXY.split(',').includes(name));
  assert.equal(proxyOptions({https_proxy:'http://127.0.0.1:7897'}).HTTPS_PROXY,'http://127.0.0.1:7897');
  console.log('Workbench system proxy and local vault bypass checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
