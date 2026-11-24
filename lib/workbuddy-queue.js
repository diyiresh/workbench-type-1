"use strict";
const { inactive } = require("./archive");
const fs = require('fs');
const path = require('path');
function claim(root, {eligible=()=>true,onClaim=()=>null}={}) {
  fs.mkdirSync(root,{recursive:true});
  const lock=path.join(root,'claim.lock');
  let fd;
  try {fd=fs.openSync(lock,'wx');}
  catch(error){if(error.code==='EEXIST')return {status:'locked',assignment:null};throw error;}
  try {
    const files=fs.readdirSync(root).filter(n=>n.endsWith('.request.json')).sort();
    const requests=files.map(name=>({file:path.join(root,name),value:JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))}));
    const time=Date.now();
    const outstanding=requests.find(({value:r})=>r.status==='claimed'&&Date.parse(r.expiresAt)>time&&!fs.existsSync(r.resultPath));
    if(outstanding) {
      fs.writeFileSync(path.join(root,'heartbeat.json'),JSON.stringify({checkedAt:new Date().toISOString(),status:'busy',jobId:outstanding.value.jobId},null,2));
      return {status:'busy',assignment:null};
    }
    const chosen=requests.find(({value:r})=>r.status==='queued'&&r.transport==='desktop-scheduled'&&Date.parse(r.expiresAt)>time&&eligible(r));
    const heartbeat={checkedAt:new Date().toISOString(),status:chosen?'claimed':'idle',jobId:chosen?.value.jobId||null};
    if(!chosen){fs.writeFileSync(path.join(root,'heartbeat.json'),JSON.stringify(heartbeat,null,2));return {status:'idle',assignment:null};}
    const request=chosen.value;
    const expected=path.resolve(root,request.jobId+'.result.json');
    if(!/^[a-zA-Z0-9-]+$/.test(request.jobId)||path.resolve(request.resultPath)!==expected)throw new Error('queue_result_path_mismatch');
    const receipt=onClaim(request);
    if(receipt)Object.assign(request,receipt);
    request.status='claimed';request.claimedAt=new Date().toISOString();
    fs.writeFileSync(chosen.file,JSON.stringify(request,null,2));
    fs.writeFileSync(path.join(root,'heartbeat.json'),JSON.stringify(heartbeat,null,2));
    const draftPath=path.resolve(root,request.jobId+'.draft.txt');
    const script=path.resolve(__dirname,'..','scripts','workbuddy-queue.js');
    return {status:'claimed',assignment:{jobId:request.jobId,attemptId:request.attemptId,claimId:request.claimId,inputHash:request.inputHash,runId:request.runId,itemId:request.itemId,prompt:request.prompt+(request.attemptId?`\n本次领取凭证：attemptId=${request.attemptId}；claimId=${request.claimId}。\n在你实际开始处理本次任务时，先运行开始回执命令：node \"${script}\" started ${request.jobId}。此命令只登记成员自报开始，不证明独立核验或实际完成，也不改变任务批准。若回执被拒绝，停止处理并报告原因。\n正文报送：只将完整实际成果正文写入 UTF-8 文本文件 \"${draftPath}\"，不要自己构造回执 JSON。然后运行：node \"${script}\" submit ${request.jobId} \"${draftPath}\"。脚本核对本机当前领取与输入后自动封装 jobId、agentId、attemptId、claimId、output 五个字段。该命令只报送正文，不批准写作、不代表通过独立复核；失败时保留草稿并报告错误，不覆盖旧成果。`:''),draftPath,resultPath:request.resultPath}};
  } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
function status(root) {
  let heartbeat=null;
  try {heartbeat=JSON.parse(fs.readFileSync(path.join(root,'heartbeat.json'),'utf8'));}catch(_){}
  return {transport:'desktop-scheduled',intervalMinutes:60,heartbeat,online:!!heartbeat&&Date.now()-Date.parse(heartbeat.checkedAt)<75*60000};
}
function eligibleRequest(store, request) {
  const report = (store.agendaReportJobs || []).find(j => j.id === request.runId && j.attemptId === request.attemptId && j.agentId === 'workbuddy');
  if (report) {
    const a = (store.executionAttempts || []).find(a => a.id === request.attemptId);
    return !inactive(report) && !inactive((store.agents || []).find(a => a.id === 'workbuddy')) && ['waiting', 'doing'].includes(report.status) && a?.purpose === 'agenda-report' && a.state === 'waiting' && a.jobId === request.jobId;
  }
  const run=(store.departmentRuns||[]).find(r=>r.id===request.runId);
  if(!run||inactive(run)||inactive((store.agents||[]).find(a=>a.id==='workbuddy')))return false;
  const chat=(store.chatJobs||[]).find(j=>!inactive(j)&&j.id===request.jobId&&j.runId===run.id&&j.agentId==='workbuddy'&&['waiting','doing'].includes(j.status));
  if(chat)return true;
  const job=(store.externalJobs||[]).find(j=>!inactive(j)&&j.id===request.jobId&&['doing','waiting'].includes(j.status));
  return !!job&&!!run.externalAutomation&&!run.automationPaused&&run.workbuddyTransport==='desktop-scheduled';
}
module.exports={claim,status,eligibleRequest};
