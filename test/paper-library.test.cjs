'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{Readable}=require('node:stream'),https=require('node:https');
const {createLibrary,parseCatalog,candidate,publicFetch}=require('../lib/paper-library');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-library-test-'));
const entry=(id,title='Sample')=>({title,desc:'Collector-provided metadata',links:[{label:'paper',url:'https://arxiv.org/abs/'+id}]});
function source(items){return Buffer.from('window.AGENT_DATA = '+JSON.stringify({sections:[{title:'Research',subsections:[{title:'Memory',items}]}],stats:{papers:999}})+';');}
const pdf=Buffer.from('%PDF-1.4\nfixture full content\n%%EOF\n');
let store={tasks:[{id:'preserve-me'}]},items=[entry('2601.14192'),entry('2601.14192v2','Duplicate'),entry('2401.03568')],calls=0,mode='valid',pending;
const readStore=()=>structuredClone(store),writeStore=s=>{store=structuredClone(s);};
const lib=createLibrary({dataDir:root,readStore,writeStore,fetchBytes:async(url,options)=>{
 if(options.source){if(mode==='source-failed')throw Error('offline');return source(items);}
 calls++;if(mode==='wait')await new Promise(r=>pending=r);if(mode==='failed')throw Error('network_failed');
 const b=mode==='invalid'?Buffer.from('<html>login</html>'):pdf;options.onProgress({bytes:b.length,total:b.length});return b;
}});
async function done(){for(let i=0;i<100&&lib.list().activeDownload;i++)await new Promise(r=>setTimeout(r,5));assert.equal(lib.list().activeDownload,null);}
(async()=>{
 assert.throws(()=>parseCatalog(Buffer.from('window.AGENT_DATA = {}; execute();')),/format/);
 assert.throws(()=>parseCatalog(source([])),/empty/);
 assert.equal(candidate([{url:'http://127.0.0.1/a.pdf',label:'pdf'}]),null);
 assert.equal(candidate([{url:'https://arxiv.org.evil.test/pdf/2601.14192',label:'pdf'}]),null);
 assert.equal(candidate([{url:'https://arxiv.org/pdf/2601.14192.pdf',label:'paper'}]),'https://arxiv.org/pdf/2601.14192');
 let catalog=await lib.import();assert.equal(catalog.source.rawEntries,3);assert.equal(catalog.records.length,2);
 const [a,b]=catalog.records;lib.patch(a.id,{favorite:true,readingStatus:'reading'});
 assert.throws(()=>lib.patch(a.id,{pdf:{file:'../../escape'}}),/rejected/);
 assert.throws(()=>lib.patch(a.id,{readingStatus:'fiction'}),/invalid/);
 await lib.import();assert.equal(lib.list().records[0].favorite,true);assert.equal(lib.list().records[0].readingStatus,'reading');
 mode='wait';lib.download(a.id);assert.equal(lib.download(a.id).status,'downloading');assert.throws(()=>lib.download(b.id),/busy/);pending();await done();
 assert.equal(lib.list().jobs[a.id].status,'saved');const firstCalls=calls;
 assert.equal(lib.download(a.id).reused,true);assert.equal(calls,firstCalls);assert.deepEqual(lib.file(a.id).bytes,pdf);
 mode='valid';lib.download(b.id);await done();assert.equal(lib.list().records[0].pdf.file,lib.list().records[1].pdf.file);
 fs.writeFileSync(lib.file(a.id).file,'changed');assert.throws(()=>lib.file(a.id),/changed/);
 lib.download(a.id);await done();assert.equal(lib.list().jobs[a.id].status,'saved');assert.ok(fs.readdirSync(path.join(root,'papers')).some(f=>f.includes('.changed-')));
 assert.deepEqual(lib.file(a.id).bytes,pdf);
 fs.unlinkSync(lib.file(a.id).file);assert.throws(()=>lib.file(a.id),/missing/);mode='failed';lib.download(a.id);await done();assert.equal(lib.list().jobs[a.id].status,'failed');
 mode='invalid';lib.download(a.id);await done();assert.match(lib.list().jobs[a.id].error,/invalid/);
 mode='valid';lib.download(a.id);await done();assert.equal(lib.list().jobs[a.id].status,'saved');
 items=[entry('2401.03568')];await lib.import();assert.equal(lib.list().records.find(r=>r.id===a.id).sourcePresent,false);assert.equal(lib.list().records.find(r=>r.id===a.id).favorite,true);
 const saved=structuredClone(store);mode='source-failed';await assert.rejects(lib.import(),/offline/);assert.deepEqual(store,saved);assert.deepEqual(store.tasks,[{id:'preserve-me'}]);
 // Exercise real downloader validation with a fake transport, never external network.
 await assert.rejects(publicFetch('https://127.0.0.1/file.pdf'),/host_blocked/);
 await assert.rejects(publicFetch('https://arxiv.org:444/file.pdf'),/host_blocked/);
 const original=https.get;let response;
 https.get=(url,options,callback)=>{
  const req=new EventEmitter();req.destroy=error=>{if(error)req.emit('error',error);req.emit('close');};
  process.nextTick(()=>{const res=Readable.from([response.bytes||pdf]);res.headers=response.headers||{'content-type':'application/pdf','content-length':String(pdf.length)};res.statusCode=response.status||200;res.on('end',()=>req.emit('close'));res.on('close',()=>req.emit('close'));callback(res);});return req;
 };
 try{
  response={};assert.deepEqual(await publicFetch('https://arxiv.org/pdf/2601.14192'),pdf);
  response={status:302,headers:{location:'https://localhost/secret'}};await assert.rejects(publicFetch('https://arxiv.org/pdf/2601.14192'),/host_blocked/);
  response={headers:{'content-type':'text/html'}};await assert.rejects(publicFetch('https://arxiv.org/pdf/2601.14192'),/not_pdf/);
  response={headers:{'content-type':'application/pdf','content-length':'999'}};await assert.rejects(publicFetch('https://arxiv.org/pdf/2601.14192'),/incomplete/);
  response={};await assert.rejects(publicFetch('https://arxiv.org/pdf/2601.14192',{limit:4}),/too_large/);
  await assert.rejects(publicFetch('https://arxiv.org/pdf/2601.14192',{timeout:0}),/timeout/);
 }finally{https.get=original;}
 console.log('Paper library: safe JSON import, identity merge, favorites/state retention, source removal, atomic failure, selected downloads, concurrent ownership, content reuse, PDF validation, redirect/host/size/time guards, tamper detection and recoverable repair passed. Isolated ledger/files; zero live downloads.');
})().catch(e=>{console.error(e);process.exitCode=1;});
