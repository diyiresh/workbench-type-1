'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const provider=require('../lib/providers/deepseek');
const {pathToFileURL}=require('node:url');
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'harness-test-'));
 const dir=path.join(root,'node_modules','@deepseek-ai','dsh-base');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'cordis.patch.yml'),'- id: tool-fs\n- id: tool-pwsh\n- id: tool-web\n');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return {packageRoot:root,node:'fake-node',bin:'fake-bin'};
}
function fake(events,code=0,inspect) { return (exe,args,opts)=>{
 inspect?.(exe,args,opts);
 const child=new EventEmitter();child.pid=4321;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
 child.kill=()=>{setImmediate(()=>child.emit('close',null,'SIGTERM'));return true;};
 child.stdin.on('finish',()=>setImmediate(()=>{
  for(const row of events)child.stdout.write(typeof row==='string'?row:JSON.stringify(row)+'\n');
  child.stdout.end();child.emit('close',code,null);
 }));return child;
};}
test('parses only final text; invocation enforces sandbox plus monotonic tool denial',async t=>{
 const runtime=fixture(t);let overlay;
 const text=await provider.generate('测试','.',{}, {runtime,spawnImpl:fake([{type:'session',sessionId:'session-1'},{type:'text',text:'wrong'},{type:'final',text:'完成中文'}],0,(exe,args,opts)=>{
  assert.equal(opts.shell,false);assert.equal(opts.env.DSH_PERMISSION_MODE,'read-only');assert.equal(args.at(-1),'-');
  overlay=args[args.indexOf('--patch')+1];const patch=JSON.parse(fs.readFileSync(overlay,'utf8'));
  assert(patch.find(x=>x.id==='headless-runner').inject.includes('workbenchReadOnly'));
  assert(patch.filter(x=>x.id?.startsWith('tool-')).every(x=>x.disabled));
  const plugin=patch.find(x=>x.insert).insert[0].name;
  assert.match(fs.readFileSync(new URL(plugin),'utf8'),/tools\.guard/);
 })});assert.equal(text,'完成中文');assert.equal(fs.existsSync(overlay),false);
});
test('rejects missing final and returns positive process-close evidence',async t=>{
 let closed;
 await assert.rejects(provider.generate('x','.',{onClose:x=>closed=x},{runtime:fixture(t),spawnImpl:fake([{type:'session',sessionId:'s'}])}),e=>e.code==='output_format'&&!!e.termination.closedAt);
 assert.equal(closed.pid,4321);assert.equal(closed.sessionId,'s');
});
test('generated plugin installs a denying guard and publishes readiness only afterwards',async t=>{
 const runtime=fixture(t), target=fs.mkdtempSync(path.join(os.tmpdir(),'harness-guard-'));
 t.after(()=>fs.rmSync(target,{recursive:true,force:true}));
 provider.createIsolation(target,runtime,process.cwd());
 const plugin=await import(pathToFileURL(path.join(target,'read-only.mjs')).href);
 let guard, ready=false;
 plugin.apply({tools:{guard:f=>{guard=f;}},provide:()=>{assert.equal(typeof guard,'function');ready=true;}});
 assert.equal(ready,true);assert.match(guard({name:'pwsh',arguments:{command:'any'}}),/all tool execution is disabled/);
});
test('rejects malformed and duplicate finals',async t=>{
 const runtime=fixture(t);
 for(const rows of [['malformed\n'],[{type:'session',sessionId:'s'},{type:'final',text:'x'},{type:'final',text:'y'}]])
  await assert.rejects(provider.generate('x','.',{}, {runtime,spawnImpl:fake(rows)}),e=>e.code==='output_format');
});
test('does not accept final after nonzero exit or inconsistent session identity',async t=>{
 const runtime=fixture(t);
 await assert.rejects(provider.generate('x','.',{}, {runtime,spawnImpl:fake([{type:'session',sessionId:'s'},{type:'final',text:'partial'}],1)}),e=>e.code==='runtime_unavailable');
 await assert.rejects(provider.generate('x','.',{}, {runtime,spawnImpl:fake([{type:'session',sessionId:'s'},{type:'session',sessionId:'other'},{type:'final',text:'partial'}])}),e=>e.code==='output_format');
});
test('sanitizes API credentials in error events',async t=>{
 await assert.rejects(provider.generate('x','.',{}, {runtime:fixture(t),spawnImpl:fake([{type:'error',code:'auth',message:'API key sk-123456789abcdef invalid'}],1)}),e=>!e.message.includes('123456789abcdef'));
});
test('timeout requests termination and reports closed evidence',async t=>{
 const spawnImpl=()=>{const c=new EventEmitter();c.pid=42;c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{setImmediate(()=>c.emit('close',null,'SIGTERM'));return true;};return c;};
 await assert.rejects(provider.generate('x','.',{}, {runtime:fixture(t),spawnImpl,timeoutMs:10}),e=>e.code==='result_uncertain'&&e.termination.stopRequested===true);
});
