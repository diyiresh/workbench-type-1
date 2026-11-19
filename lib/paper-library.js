'use strict';
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const SOURCE='https://agent01-7e0.pages.dev/';
const HOSTS=new Set(['arxiv.org','export.arxiv.org','openaccess.thecvf.com','proceedings.neurips.cc','papers.nips.cc','openreview.net']);
const MAX=40*1024*1024;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=(code,status=400)=>Object.assign(new Error(code),{status});
function safeUrl(raw){try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)return null;u.hash='';return u;}catch{return null;}}
function candidate(links){
 for(const l of links){const u=safeUrl(l.url);if(!u)continue;
  if(['arxiv.org','export.arxiv.org'].includes(u.hostname)){
   const m=u.pathname.match(/^\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?)(?:\.pdf)?$/i);
   if(m)return 'https://arxiv.org/pdf/'+m[1];
  }
 }
 for(const l of links){const u=safeUrl(l.url);if(!u||!HOSTS.has(u.hostname)||u.protocol!=='https:')continue;
  if(u.hostname==='openreview.net'&&u.pathname==='/pdf'&&u.searchParams.get('id'))return u.href;
  if(u.pathname.toLowerCase().endsWith('.pdf'))return u.href;
 }
 return null;
}
function parseCatalog(bytes){
 const text=bytes.toString('utf8');const m=text.match(/^\s*window\.AGENT_DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
 if(!m)throw fail('paper_source_format_invalid');let d;try{d=JSON.parse(m[1]);}catch{throw fail('paper_source_json_invalid');}
 if(!Array.isArray(d.sections)||d.sections.length>100)throw fail('paper_source_schema_invalid');
 const records=new Map(),collections=[];let entries=0;
 for(const section of d.sections){
  if(!Array.isArray(section.subsections))throw fail('paper_source_schema_invalid');
  for(const sub of section.subsections){
   if(!Array.isArray(sub.items))throw fail('paper_source_schema_invalid');
   for(const c of (Array.isArray(sub.collection)?sub.collection.slice(0,30):[])){const u=safeUrl(c.url);if(u)collections.push({title:String(c.text||'Collection').slice(0,500),url:u.href,claimedCount:Number(c.count)||null});}
   for(const item of sub.items){
    if(++entries>5000)throw fail('paper_source_too_many_entries');
    if(typeof item.title!=='string'||!item.title.trim()||item.title.length>2000||!Array.isArray(item.links))throw fail('paper_source_item_invalid');
    const links=item.links.slice(0,30).flatMap(l=>{const u=safeUrl(l.url);return u?[{label:String(l.label||'source').slice(0,40),url:u.href}]:[];});
    const pdfUrl=candidate(links), arxiv=pdfUrl?.match(/arxiv\.org\/pdf\/(.+)/)?.[1].replace(/v\d+$/,'');
    const doi=links.map(l=>l.url.match(/https?:\/\/(?:dx\.)?doi\.org\/(10\..+)/i)?.[1]).find(Boolean);
    const identity=arxiv?'arxiv:'+arxiv:doi?'doi:'+doi.toLowerCase():'url:'+(links.find(l=>['paper','pdf','arxiv'].includes(l.label))||links[0])?.url;
    if(!links.length)continue;
    const id='paper-'+hash(identity).slice(0,24),category=[String(section.title||'').slice(0,200),String(sub.title||'').slice(0,200)].filter(Boolean).join(' / ');
    const previous=records.get(id);
    if(previous){previous.categories=[...new Set([...previous.categories,category])];for(const l of links)if(!previous.links.some(x=>x.url===l.url))previous.links.push(l);previous.pdfUrl=candidate(previous.links);}
    else records.set(id,{id,identity,title:item.title.trim(),description:typeof item.desc==='string'?item.desc.slice(0,12000):'',categories:[category],links,pdfUrl,kind:links.some(l=>['paper','pdf','arxiv'].includes(l.label))?'paper':'resource',sourcePresent:true});
   }
  }
 }
 if(!records.size)throw fail('paper_source_empty');
 return {records:[...records.values()],source:{url:SOURCE,dataUrl:SOURCE+'data.js',sha256:hash(bytes),importedAt:new Date().toISOString(),rawEntries:entries,uniqueRecords:records.size,collections,claimedStats:d.stats||{}}};
}
function publicFetch(raw,{limit=MAX,timeout=60000,source=false,onProgress=()=>{}}={}){
 const deadline=Date.now()+timeout;
 function request(url,redirects=0){return new Promise((resolve,reject)=>{
  const u=safeUrl(url);if(!u||u.protocol!=='https:'||!(source?u.hostname==='agent01-7e0.pages.dev'&&u.pathname==='/data.js':HOSTS.has(u.hostname)))return reject(fail('paper_download_host_blocked'));
  if(redirects>4)return reject(fail('paper_redirect_limit'));
  const remaining=deadline-Date.now();if(remaining<=0)return reject(fail('paper_download_timeout'));
  const req=https.get(u,{headers:{'User-Agent':'Mozilla/5.0 (Workbench Paper Library)','Accept':source?'application/javascript, text/plain':'application/pdf'}},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();if(!res.headers.location)return reject(fail('paper_redirect_missing'));resolve(request(new URL(res.headers.location,u).href,redirects+1));return;}
   if(res.statusCode!==200){res.resume();return reject(fail('paper_source_http_'+res.statusCode));}
   const total=Number(res.headers['content-length'])||0;if(total>limit){res.destroy();return reject(fail('paper_file_too_large'));}
   if(!source&&!/^(application\/pdf|application\/octet-stream)(?:;|$)/i.test(res.headers['content-type']||'')){res.resume();return reject(fail('paper_response_not_pdf'));}
   const chunks=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>limit){res.destroy(fail('paper_file_too_large'));return;}chunks.push(chunk);onProgress({bytes:size,total});});
   res.on('error',reject);res.on('aborted',()=>reject(fail('paper_download_incomplete')));
   res.on('end',()=>{if(total&&size!==total)return reject(fail('paper_download_incomplete'));resolve(Buffer.concat(chunks));});
  });
  const timer=setTimeout(()=>req.destroy(fail('paper_download_timeout')),remaining);
  req.on('close',()=>clearTimeout(timer));req.on('error',reject);
 });}
 return request(raw);
}
function createLibrary({readStore,writeStore,dataDir,fetchBytes=publicFetch}){
 const root=path.join(dataDir,'papers'),jobs=new Map();let importing=false,active=null;
 const library=()=>readStore().paperLibrary||{records:[],source:null};
 const get=id=>{const r=library().records.find(r=>r.id===id);if(!r)throw fail('paper_not_found',404);return r;};
 function storage(){fs.mkdirSync(root,{recursive:true});if(fs.lstatSync(root).isSymbolicLink())throw fail('paper_storage_link_rejected');}
 function verify(pdf){
  if(!pdf||!/^paper-[a-f0-9]{24}-[a-f0-9]{16}\.pdf$/.test(pdf.file)||!/^[a-f0-9]{64}$/.test(pdf.sha256))throw fail('paper_file_missing',404);
  storage();const file=path.join(root,pdf.file);let b;
  try{if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw Error();b=fs.readFileSync(file);}catch{throw fail('paper_file_missing',404);}
  if(b.length!==pdf.size||hash(b)!==pdf.sha256)throw fail('paper_file_changed',409);
  return {file,bytes:b};
 }
 const update=(id,fn)=>{const s=readStore();const r=s.paperLibrary?.records.find(r=>r.id===id);if(!r)throw fail('paper_not_found',404);fn(r);writeStore(s);return r;};
 return {
  list(){return {...library(),jobs:Object.fromEntries(jobs),activeDownload:active};},
  async import(){
   if(importing)throw fail('paper_import_busy',409);importing=true;
   try{
    const parsed=parseCatalog(await fetchBytes(SOURCE+'data.js',{source:true,limit:4*1024*1024,timeout:30000}));
    const s=readStore(),old=s.paperLibrary?.records||[],oldMap=new Map(old.map(r=>[r.id,r]));
    const records=parsed.records.map(r=>({...r,readingStatus:oldMap.get(r.id)?.readingStatus||'unread',favorite:oldMap.get(r.id)?.favorite===true,pdf:oldMap.get(r.id)?.pdf||null}));
    const current=new Set(records.map(r=>r.id));for(const r of old)if(!current.has(r.id))records.push({...r,sourcePresent:false});
    s.paperLibrary={source:parsed.source,records};writeStore(s);return this.list();
   }finally{importing=false;}
  },
  patch(id,body){
   if(!body||Object.keys(body).some(k=>!['favorite','readingStatus'].includes(k)))throw fail('paper_patch_rejected');
   if(body.favorite!==undefined&&typeof body.favorite!=='boolean')throw fail('paper_favorite_invalid');
   if(body.readingStatus!==undefined&&!['unread','reading','finished'].includes(body.readingStatus))throw fail('paper_reading_status_invalid');
   return update(id,r=>Object.assign(r,body));
  },
  download(id){
   const record=get(id);if(jobs.get(id)?.status==='downloading')return jobs.get(id);
   if(record.pdf){try{verify(record.pdf);return {status:'saved',bytes:record.pdf.size,reused:true};}catch{ /* repair on explicit request */ }}
   if(active)throw fail('paper_download_busy',409);
   const url=candidate(record.links);if(!url)throw fail('paper_direct_pdf_unavailable',409);
   const job={status:'downloading',bytes:0,total:0,startedAt:new Date().toISOString()};jobs.set(id,job);active=id;
   (async()=>{
    try{
     const bytes=await fetchBytes(url,{limit:MAX,timeout:60000,onProgress:p=>Object.assign(job,p)});
     if(bytes.length>MAX||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||!bytes.subarray(-2048).includes(Buffer.from('%%EOF')))throw fail('paper_pdf_invalid_or_incomplete');
     const sha256=hash(bytes);let file=id+'-'+sha256.slice(0,16)+'.pdf';storage();
     const identical=library().records.find(r=>r.pdf?.sha256===sha256);
     if(identical){try{verify(identical.pdf);file=identical.pdf.file;}catch{/* keep independent intact copy */}}
     const target=path.join(root,file);
     if(fs.existsSync(target)){if(fs.lstatSync(target).isSymbolicLink())throw fail('paper_existing_file_conflict');if(hash(fs.readFileSync(target))!==sha256)fs.renameSync(target,target+'.changed-'+crypto.randomUUID());}
     if(!fs.existsSync(target)) {const tmp=target+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,bytes,{flag:'wx'});if(hash(fs.readFileSync(tmp))!==sha256)throw fail('paper_readback_failed');fs.renameSync(tmp,target);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
     const pdf={file,sha256,size:bytes.length,sourceUrl:url,savedAt:new Date().toISOString()};verify(pdf);update(id,r=>{r.pdf=pdf;});Object.assign(job,{status:'saved',bytes:bytes.length,sha256});
    }catch(error){Object.assign(job,{status:'failed',error:error.message});}
    finally{active=null;}
   })();
   return job;
  },
  file(id){return verify(get(id).pdf);},
 };
}
module.exports={createLibrary,parseCatalog,candidate,publicFetch,SOURCE,HOSTS};
