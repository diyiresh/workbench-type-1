'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLedger}=require('../lib/ledger-store');
if(process.argv[2]==='worker'){
  const [file,section,value]=process.argv.slice(3),ledger=createLedger({file,log:{warn(){}}});
  const snapshot=ledger.load();snapshot[section].push(value);
  process.on('message',command=>{
    if(command!=='write')return;
    try{ledger.write(snapshot);process.send({result:'saved'});}catch(error){process.send({result:error.code});}
  });
  process.send({result:'ready'});
}else{
  const {test}=require('node:test'),assert=require('node:assert/strict'),{fork}=require('node:child_process');
  function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-ledger-process-')),file=path.join(root,'store.json');fs.writeFileSync(file,JSON.stringify({tasks:[],departmentRuns:[]}));return file;}
  const message=child=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child receipt timeout')),5000);child.once('message',m=>{clearTimeout(timer);resolve(m.result);});child.once('error',reject);});
  async function worker(t,file,section,value){const child=fork(__filename,['worker',file,section,value],{stdio:['ignore','ignore','pipe','ipc']});t.after(()=>child.kill());assert.equal(await message(child),'ready');return child;}
  async function write(child){const received=message(child);child.send('write');return received;}
  test('separate processes preserve unrelated sections from stale snapshots',async t=>{
    const file=fixture(),a=await worker(t,file,'tasks','first'),b=await worker(t,file,'departmentRuns','second');
    assert.equal(await write(a),'saved');assert.equal(await write(b),'saved');
    assert.deepEqual(JSON.parse(fs.readFileSync(file)),{tasks:['first'],departmentRuns:['second']});
  });
  test('separate processes reject conflicting project changes and retain the first commit',async t=>{
    const file=fixture(),a=await worker(t,file,'departmentRuns','paused'),b=await worker(t,file,'departmentRuns','completed');
    assert.equal(await write(a),'saved');assert.equal(await write(b),'ledger_write_conflict');
    assert.deepEqual(JSON.parse(fs.readFileSync(file)).departmentRuns,['paused']);assert(!fs.existsSync(file+'.write-lock'));
  });
  test('busy or unverified orphan locks fail closed and cannot be deleted by a contender',async t=>{
    const file=fixture(),a=await worker(t,file,'tasks','blocked'),lock=file+'.write-lock';
    fs.writeFileSync(lock,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
    assert.equal(await write(a),'ledger_write_busy');assert(fs.existsSync(lock));assert.deepEqual(JSON.parse(fs.readFileSync(file)).tasks,[]);
    fs.unlinkSync(lock);assert.equal(await write(a),'saved');
  });
}
