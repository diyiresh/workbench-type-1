import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorker } from '../lib/desktop-worker.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-worker-'));
let actions = [], tree = '24 选项卡项目 (selectable) New Task\n317 编辑 (settable, string) Value: What can I help\n329 按钮 Send';
const sky = {
  list_apps: async () => [{displayName:'WorkBuddy',windows:[{id:'w',app:'WorkBuddy.exe'}]}],
  get_window: async x => x,
  get_window_state: async ({window}) => ({window,accessibility:{tree}}),
  click: async x => actions.push(['click',x.element_index]),
  type_text: async x => {actions.push(['type',x.text]); tree += '\njob-a';}
};
try {
  const file = path.join(root,'job-a.request.json');
  await fs.writeFile(file,JSON.stringify({jobId:'job-a',status:'queued',prompt:'job-a',resultPath:path.join(root,'job-a.result.json')}));
  const worker = createWorker({sky,root});
  for (const status of ['opening','focused','typed','transmitting']) {
    const before=actions.length;
    assert.equal((await worker.tick()).status,status);
    assert.equal(actions.length-before,1);
  }
  assert.equal((await worker.tick()).status,'awaiting_confirmation');
  assert.equal(actions.length,4,'uncertain send is never replayed');
  tree += '\n330 按钮 Stop';
  assert.equal((await worker.tick()).status,'sent');
  await fs.writeFile(path.join(root,'job-b.request.json'),JSON.stringify({jobId:'job-b',status:'queued'}));
  assert.equal((await worker.tick()).status,'awaiting_resolution');
  assert.equal(actions.length,4,'outstanding result blocks second project');
  assert.equal((await createWorker({sky,root,pause:()=>true}).tick()).status,'paused');
  console.log('Desktop worker single-action, uncertainty, serial and pause checks passed');
} finally {await fs.rm(root,{recursive:true,force:true});}
