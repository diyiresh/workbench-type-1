const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const { EventEmitter } = require('events');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'cursor-long-test-'));
const base = path.join(root,'local');
const installation = path.join(base,'cursor-agent','versions','2026.10.01-abcdef');
fs.mkdirSync(installation,{recursive:true});
for(const name of ['node.exe','index.js'])fs.writeFileSync(path.join(installation,name),'fixture');
const prompt = '完整报告\n'.repeat(10000);
let args;
const sandbox = { __dirname:path.join(root,'lib'), module:{exports:{}}, process:{env:{LOCALAPPDATA:base}}, setTimeout,clearTimeout, require(name){
  if(name === 'child_process')return { spawn(file, values){
    args=values; assert(values.at(-1).length < 1000);
    const files=fs.readdirSync(path.join(root,'data','agent-prompts'));
    assert.equal(fs.readFileSync(path.join(root,'data','agent-prompts',files[0]),'utf8'),prompt);
    const child=new EventEmitter(); child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    setImmediate(()=>{child.stdout.emit('data',JSON.stringify({result:'VERDICT: PASS'}));child.emit('close',0)});return child;
  }};
  if(name === './codex')return {networkEnvironment:async()=>({})};
  if(name.startsWith('./'))return require(path.resolve('lib',name));
  return require(name);
}};
vm.runInNewContext(fs.readFileSync('lib/external-runtime.js','utf8'),sandbox);
(async()=>{try{assert.equal(await sandbox.module.exports.generate('cursor',prompt,root),'VERDICT: PASS');assert(args);assert.equal(fs.readdirSync(path.join(root,'data','agent-prompts')).length,0);console.log('Cursor long prompt file handoff and cleanup regression passed')}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
