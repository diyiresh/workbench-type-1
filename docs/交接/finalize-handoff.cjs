const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const out=__dirname,root=path.resolve(out,'../..'),stamp=new Date().toISOString();
const put=(name,v)=>fs.writeFileSync(path.join(out,name),typeof v==='string'?v:JSON.stringify(v,null,2),'utf8');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{
 const state=await (await fetch('http://127.0.0.1:3780/api/state')).json();
 const run=state.departmentRuns.find(r=>r.id==='dr-vruuszla5e');
 if(!run)throw Error('missing live run');
 const snapshot={capturedAt:stamp,authority:'只读交接快照；原 data/store.json 为唯一台账',run,tasks:state.tasks.filter(t=>t.id==='t-bench-v1'),specs:state.specs,departmentRunsSummary:state.departmentRuns.map(r=>({id:r.id,title:r.title,status:r.status,archived:r.archived})),projectMessages:state.projectMessages.filter(x=>x.runId===run.id),inbox:state.inbox.filter(x=>x.runId===run.id),externalJobs:state.externalJobs.filter(x=>x.runId===run.id),codexJobs:state.codexJobs.filter(x=>x.runId===run.id),chatJobs:state.chatJobs.filter(x=>x.runId===run.id)};
 put('evidence/当前台账.json',snapshot);
 const channels={capturedAt:stamp};
 for(const [key,url] of [['health','/api/health'],['codex','/api/codex/status']]) {const res=await fetch('http://127.0.0.1:3780'+url);channels[key]={httpStatus:res.status,body:await res.json()};}
 put('evidence/服务状态.json',channels);
 const records=[];
 const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 for(const args of [['test'],['run','test:agents']]){const startedAt=new Date().toISOString();const r=cp.spawnSync(process.execPath,[npmCli,...args],{cwd:root,encoding:'utf8',timeout:120000,windowsHide:true});records.push({command:'npm '+args.join(' '),startedAt,completedAt:new Date().toISOString(),exitCode:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message});if(r.status!==0)throw Error('test failed: '+args.join(' '));}
 const browserModule='C:/Users/Benjamin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
 for(const file of ['chat-input.browser.cjs','department-scroll.browser.cjs','chat-bubbles.browser.cjs','agenda-edit.browser.cjs']){
  if(!fs.existsSync(browserModule))break;
  const startedAt=new Date().toISOString(),r=cp.spawnSync(process.execPath,[path.join(root,'test',file)],{cwd:root,encoding:'utf8',timeout:90000,windowsHide:true,env:{...process.env,PLAYWRIGHT_MODULE:browserModule}});
  records.push({command:'node test/'+file,startedAt,completedAt:new Date().toISOString(),exitCode:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message});
 }
 put('evidence/测试记录.json',records);
 const recent=run.discussion.filter(x=>x.role==='reviewer'&&String(x.text||'').startsWith('退回返工：'));
 put('evidence/实际退回意见.json',recent);
 let md=fs.readFileSync(path.join(out,'06-当前台账与未完成事项.md'),'utf8');
 md+='\n## 本次实时取证补充\n\n取证 '+stamp+'。正式退回记录 '+recent.length+' 条。\n\n'+run.items.map(i=>'- '+i.role+' / '+i.ownerAgentId+' / '+i.status).join('\n')+'\n\n最近一条实际退回（历史审核意见；事实仍以原件核验）：\n\n'+(recent.at(-1)?.text||'无')+'\n';put('06-当前台账与未完成事项.md',md);
 const evidenceFiles=[];
 for(const j of snapshot.externalJobs)if(j.artifactPath&&fs.existsSync(j.artifactPath)) {const dest=path.join(out,'evidence','agent-results',path.basename(j.artifactPath));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(j.artifactPath,dest);evidenceFiles.push({jobId:j.id,sourcePath:j.artifactPath,path:dest});}
 put('evidence/成果文件索引.json',evidenceFiles);
 const files=[];
 function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory())walk(p);else if(d.isFile()&&!['manifest.json','交接校验.json'].includes(d.name))files.push({path:path.relative(out,p),bytes:fs.statSync(p).size,sha256:hash(p)});}}
 walk(out);put('manifest.json',{schemaVersion:1,capturedAt:stamp,workspace:root,scope:'文档、可见对话与调用位置索引、当前源码副本、指定项目只读状态与验收证据。不含账号目录、完整原始工具日志或大型运行时。',files});
 const failures=files.filter(x=>hash(path.join(out,x.path))!==x.sha256);
 put('evidence/交接校验.json',{verifiedAt:new Date().toISOString(),files:files.length,hashFailures:failures,documentCount:fs.readdirSync(out).filter(x=>/^0[1-9]-.*\.md$/.test(x)).length,testCommands:records.map(r=>({command:r.command,exitCode:r.exitCode})),runStatus:run.status,automationPaused:run.automationPaused,writingApproved:run.writingApproved,items:run.items.map(i=>({role:i.role,owner:i.ownerAgentId,status:i.status})),note:'没有启动第二服务，没有修改业务项目/队列/认证，没有重新发送模型测试消息。'});
 console.log(JSON.stringify({files:files.length,hashFailures:failures.length,tests:records.map(r=>({command:r.command,exitCode:r.exitCode})),state:run.status,paused:run.automationPaused}));
})().catch(e=>{console.error(e);process.exitCode=1;});
