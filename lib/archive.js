"use strict";

// Archive is a visibility/execution flag, never a completion status.
const PATHS = Object.freeze({
  modules: ['modules'], tasks: ['tasks'], departmentRuns: ['departmentRuns'],
  agendas: ['agendas'], plans: ['plans'], briefRuns: ['briefRuns'], briefSources: ['briefSources'],
  reports: ['reports'], inbox: ['inbox'], agents: ['agents'], memories: ['memories'],
  lessons: ['lessons'], skills: ['skills'], prompts: ['prompts'], specs: ['specs'],
  events: ['events'], codexJobs: ['codexJobs'], externalJobs: ['externalJobs'], chatJobs: ['chatJobs'],
  projectMessages: ['projectMessages'], artifacts: ['artifacts'], skillLibrary:['skillLibrary'],
  frontLearn: ['fronts', 'learn'], frontLife: ['fronts', 'life'],
  habitTemplates: ['lifeSystem', 'habitTemplates'], habitRuns: ['lifeSystem', 'habitRuns'],
  learningPlans: ['lifeSystem', 'learningPlans'],
});
const EXECUTABLE = new Set(['modules','tasks','departmentRuns','agendas','plans','inbox','agents','frontLearn','frontLife','habitTemplates','learningPlans','briefSources','skillLibrary']);
function list(store, collection) {
  if (!Object.hasOwn(PATHS, collection)) throw new Error('archive_collection_not_allowed');
  return PATHS[collection].reduce((value, key) => value?.[key], store) || [];
}
function inactive(record) { return !!record && (record.archived || record.status === 'archive' || record.resumeRequired); }
function finished(record) { return record.done === true || ['done','completed','cancelled'].includes(record.status); }
function operationalStore(store) {
  const copy = { ...store };
  for (const [collection, keys] of Object.entries(PATHS)) {
    if (keys.length === 1) copy[collection] = list(store, collection).filter(item => !inactive(item));
  }
  copy.fronts = { ...store.fronts };
  copy.lifeSystem = { ...store.lifeSystem };
  for (const [collection, keys] of Object.entries(PATHS)) {
    if (keys.length === 2) copy[keys[0]][keys[1]] = list(store, collection).filter(item => !inactive(item));
  }
  return copy;
}
function migrateArchive(store) {
  store.meta ||= {};
  if (!['zh-CN','en'].includes(store.meta.language)) store.meta.language = 'zh-CN';
  for (const task of store.tasks || []) {
    if (task.status !== 'archive') continue;
    task.archived = true;
    task.archivedAt ||= task.updatedAt || new Date().toISOString();
    task.status = task.statusBeforeArchive || 'todo';
    task.resumeRequired = true;
    task.legacyArchiveStatus = true;
  }
}
function resolve(store, ref) {
  if (!ref || typeof ref.id !== 'string') throw new Error('archive_id_required');
  const record = list(store, ref.collection).find(item => item.id === ref.id);
  if (!record) throw new Error('archive_record_not_found');
  return { ...ref, record };
}
function related(store, ref) {
  const result = [];
  const add = (collection, predicate) => list(store, collection).filter(predicate).forEach(record => result.push({collection, id:record.id}));
  if (ref.collection === 'modules') {
    const module = resolve(store, ref).record;
    if (module.taskId) add('tasks', item => item.id === module.taskId);
    add('inbox', item => item.relatedModuleId === ref.id || item.relatedId === ref.id);
  }
  if (ref.collection === 'tasks') {
    add('modules', item => item.taskId === ref.id);
    add('inbox', item => item.relatedTaskId === ref.id || item.relatedId === ref.id);
  }
  if (ref.collection === 'departmentRuns') {
    for (const collection of ['inbox','projectMessages','artifacts','codexJobs','externalJobs','chatJobs']) add(collection, item => item.runId === ref.id);
  }
  if (['codexJobs','externalJobs','chatJobs'].includes(ref.collection)) {
    const job=resolve(store,ref).record;
    if(['queued','waiting','doing'].includes(job.status) && job.runId)add('departmentRuns',run=>run.id===job.runId);
  }
  if(ref.collection==='projectMessages')add('chatJobs',job=>job.messageId===ref.id);
  if (ref.collection === 'habitTemplates') add('habitRuns', item => item.habitId === ref.id);
  return result;
}
function apply(store, body, now = new Date().toISOString()) {
  if (!['archive','restore','resume'].includes(body.action)) throw new Error('archive_action_invalid');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 200) throw new Error('archive_selection_invalid');
  const roots = body.items.map(ref => resolve(store, ref));
  if (body.action === 'archive') for (const root of roots) {
    if (root.collection !== 'agents') continue;
    const busyRun = (store.departmentRuns || []).some(run => !inactive(run) && !finished(run) && run.items?.some(item => item.ownerAgentId === root.id));
    const busyTask = (store.tasks || []).some(task => !inactive(task) && !finished(task) && (task.ownerAgentId === root.id || task.helperAgentIds?.includes(root.id)));
    if (busyRun || busyTask) throw new Error('agent_has_active_assignments');
  }
  const selection = new Map();
  for (const root of roots) {
    const group = `${root.collection}:${root.id}`;
    const pending = [{collection:root.collection,id:root.id}];
    const visited = new Set();
    while (pending.length) {
      const ref = pending.shift(), key = `${ref.collection}:${ref.id}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const target = resolve(store, ref);
      if (key !== group && body.action !== 'archive' && target.record.archiveGroup !== group) continue;
      if (!selection.has(key)) selection.set(key, {...target, group});
      pending.push(...related(store, ref));
    }
  }
  for (const target of selection.values()) {
    const item = target.record;
    if (body.action === 'archive') {
      if (item.archived) continue;
      item.archived = true; item.archivedAt = now; item.archiveGroup = target.group;
      item.archiveGeneration = Number(item.archiveGeneration || 0) + 1;
      if (EXECUTABLE.has(target.collection) && !finished(item)) item.resumeRequired = true;
      if (target.collection === 'departmentRuns') {
        item.archivePreviousPaused = !!item.automationPaused;
        item.automationPaused = true;
      }
    } else if (body.action === 'restore') {
      if (!item.archived) continue;
      item.archived = false; item.restoredAt = now;
      if (EXECUTABLE.has(target.collection) && !finished(item)) item.resumeRequired = true;
    } else {
      if (item.archived) throw new Error('restore_before_resume');
      item.resumeRequired = false;
      if (target.collection === 'departmentRuns' && item.archivePreviousPaused !== undefined) item.automationPaused = item.archivePreviousPaused;
    }
    item.updatedAt = now;
    if(target.collection==='departmentRuns')item.controlGeneration=Number(item.controlGeneration||0)+1;
  }
  return [...selection.values()].map(({collection,id,record}) => ({collection,id,title:record.title || record.name || record.rule || record.body || record.text || id, archived:!!record.archived, resumeRequired:!!record.resumeRequired}));
}
function changeArchive(store, body, {preview=false} = {}) {
  // Validate the whole batch and dependency closure before committing any mutation.
  const candidate = structuredClone(store);
  const affected = apply(candidate, body);
  if (!preview) {
    for (const {collection,id} of affected) Object.assign(resolve(store,{collection,id}).record, resolve(candidate,{collection,id}).record);
  }
  return {affected, count:affected.length, action:body.action};
}
module.exports = { PATHS, list, inactive, operationalStore, migrateArchive, changeArchive };
