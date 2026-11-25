'use strict';
// Synthetic evidence for tests that exercise UI/HTTP independently of adapters.
// Never used by production enrollment or the real data directory.
module.exports=(store,run)=>{
 const flow=require('../../lib/project-workflow');run.roleChecks||={};store.executionAttempts||=[];
 for(const role of Object.keys(flow.ROLES)){
  const id='fixture-capability-'+run.id+'-'+role+'-'+run.roleAppointments.roles[role],resultHash='synthetic-'+role;
  store.executionAttempts.push({id,runId:run.id,stepId:flow.item(run,role).id,agentId:run.roleAppointments.roles[role],state:'returned',resultHash,workflowAppliedAt:new Date().toISOString(),extra:{workflowPurpose:'role-probe'}});
  run.roleChecks[role]={agentId:run.roleAppointments.roles[role],profile:flow.capabilityProfile(store,run,role),attemptId:id,resultHash,expiresAt:new Date(Date.now()+3600000).toISOString()};
 }
};
