const fs=require('fs'),path=require('path'),crypto=require('crypto');
const out=__dirname,root=path.resolve(out,'../..');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const rel of ['docs/HANDOFF.md','docs/工作台操作与开发指南.md','start-background.ps1']){
 const dest=path.join(out,'source-snapshot',rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,rel),dest);
}
for(const rel of ['WORKSPACE.md','.workbench/workspace.json']){const dest=path.join(out,'evidence/shared',rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.resolve(root,'../..',rel),dest);}
const source=JSON.parse(fs.readFileSync(path.join(out,'evidence/源码清单.json'),'utf8'));
const ps1=path.join(root,'start-background.ps1');if(!source.some(x=>x.sourcePath===ps1))source.push({sourcePath:ps1,snapshotPath:path.join(out,'source-snapshot/start-background.ps1')});
for(const x of source){x.sha256=hash(x.snapshotPath);x.bytes=fs.statSync(x.snapshotPath).size;}
fs.writeFileSync(path.join(out,'evidence/源码清单.json'),JSON.stringify(source,null,2));
const files=[];function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory())walk(p);else if(d.isFile()&&!['manifest.json','交接校验.json'].includes(d.name))files.push({path:path.relative(out,p),bytes:fs.statSync(p).size,sha256:hash(p)});}}
walk(out);const m=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));m.files=files;m.finalizedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(m,null,2));
const failures=files.filter(x=>hash(path.join(out,x.path))!==x.sha256);
const checked=JSON.parse(fs.readFileSync(path.join(out,'evidence/交接校验.json'),'utf8'));checked.verifiedAt=new Date().toISOString();checked.files=files.length;checked.hashFailures=failures;checked.sourceFiles=source.length;
checked.documents=fs.readdirSync(out).filter(x=>/^0[1-9]-.*\.md$/.test(x)).map(x=>({name:x,bytes:fs.statSync(path.join(out,x)).size}));
checked.totalBytes=files.reduce((a,x)=>a+x.bytes,0);
fs.writeFileSync(path.join(out,'evidence/交接校验.json'),JSON.stringify(checked,null,2));
if(failures.length||checked.documents.length!==9||checked.documents.some(x=>x.bytes<500))throw Error('invalid handover');
console.log(JSON.stringify({documents:9,files:files.length,sourceFiles:source.length,hashFailures:failures.length,totalBytes:checked.totalBytes}));
