'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{performance}=require('node:perf_hooks');
const pause=new Int32Array(new SharedArrayBuffer(4));
const busy=()=>Object.assign(new Error('ledger_write_busy'),{code:'ledger_write_busy',status:409});
function dead(pid){
  if(!Number.isSafeInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}
}
// Per-contender files prevent two stale-lock recoverers from deleting a new owner's lock.
// Ticket ordering follows Lamport's choosing/number protocol, with atomic file publication.
// https://www.microsoft.com/en-us/research/publication/new-solution-dijkstras-concurrent-programming-problem/
function acquire(file,{timeoutMs=400,log=console}={}){
  const root=file+'.write-contenders',key=process.pid+'-'+randomUUID(),claim=path.join(root,key+'.json');
  fs.mkdirSync(root,{recursive:true});
  const started=performance.now();let delay=5,owned=false;const ownerFile=claim+'.owner';
  function wait(){const left=timeoutMs-(performance.now()-started);if(left<=0)throw busy();Atomics.wait(pause,0,0,Math.min(delay,left));delay=Math.min(delay*2,40);}
  function publish(value){const tmp=claim+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value),{flag:'wx'});fs.renameSync(tmp,claim);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
  function others(){
    const rows=[];
    for(const name of fs.readdirSync(root))if(name.endsWith('.json')&&name!==key+'.json'){
      const target=path.join(root,name),pid=Number(name.split('-')[0]);
      if(dead(pid)){try{fs.unlinkSync(target);log.warn('[ledger] recovered exited writer contender pid='+pid);}catch(error){if(error.code!=='ENOENT')throw error;}continue;}
      try{rows.push({key:name.slice(0,-5),...JSON.parse(fs.readFileSync(target,'utf8'))});}catch(error){if(error.code!=='ENOENT')throw busy();}
    }
    return rows;
  }
  const lock=file+'.write-lock';
  try{
    publish({choosing:true,ticket:0});
    const ticket=Math.max(0,...others().map(row=>row.ticket||0))+1;
    publish({choosing:false,ticket});
    while(others().some(row=>row.choosing||!Number.isSafeInteger(row.ticket)||row.ticket<ticket||row.ticket===ticket&&row.key<key))wait();
    // This final file also cooperates with an already running pre-upgrade writer.
    fs.writeFileSync(ownerFile,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}),{flag:'wx'});
    while(!owned){
      try{fs.linkSync(ownerFile,lock);owned=true;}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        let owner;try{owner=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{}
        if(owner&&dead(owner.pid)){
          // All new writers are serialized by their unique contender claims. A live
          // legacy writer cannot own this file: only a confirmed exited PID is reclaimed.
          try{fs.unlinkSync(lock);log.warn('[ledger] recovered exited writer lock pid='+owner.pid);}catch(error){if(error.code!=='ENOENT')throw error;}
        }else wait();
      }
    }
    fs.unlinkSync(ownerFile);
  }catch(error){if(owned)fs.unlinkSync(lock);if(fs.existsSync(ownerFile))fs.unlinkSync(ownerFile);if(fs.existsSync(claim))fs.unlinkSync(claim);throw error;}
  return ()=>{try{fs.unlinkSync(lock);}finally{if(fs.existsSync(claim))fs.unlinkSync(claim);}};
}
module.exports={acquire};
