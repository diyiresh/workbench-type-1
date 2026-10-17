const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-skill-ui-'));
process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore();
state.lessons=[{id:'experience',rule:'先核对文件，再评价交付。',from:'隔离验收'}];
state.tasks=[{id:'target',title:'任务原文必须保留',status:'doing',progress:15}];
state.modules=[];
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
let executions=0;
require('../lib/codex').generate=async prompt=>{
  executions++;
  return {text:prompt.match(/SKILL_RECEIPT [^\n]+/)[0]+'\n缺少实际文件证据，应继续核验。',threadId:'browser-contract-test'};
};
const {createServer,readStore}=require('../server'),server=createServer();
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[],remote=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());if(!r.url().startsWith(base))remote.push(r.url());});
    await page.route('**/api/briefings',r=>r.fulfill({json:{items:[]}}));
    await page.goto(base+'/#assets/lessons');await page.locator('[data-skill-from="lessons"]').click();
    await page.locator('[data-skill-editor]').waitFor();
    let form=page.locator('[data-skill-editor]');
    assert.match(await form.locator('[name="markdown"]').inputValue(),/先核对文件/);
    assert.equal(readStore().skillLibrary.length,1);assert.equal(readStore().skillLibrary[0].versions.length,0);
    await form.locator('[name="name"]').fill('evidence-first');
    await form.locator('[name="description"]').fill('Check real deliverables');
    await form.locator('[name="scope"]').fill('只对提供的材料判断证据完整性。');
    const draft=await form.locator('[name="markdown"]').inputValue();
    await form.locator('[name="markdown"]').fill(draft+'\n\n## 检查清单\n- 不得把 PASS 当作实际文件。\n<img src="https://example.invalid/private" onerror="alert(1)">');
    const unsaved=await form.locator('[name="markdown"]').inputValue();
    await page.evaluate(()=>location.hash='#assets/all');await page.locator('#skill-studio').waitFor({state:'detached'});
    await page.evaluate(()=>location.hash='#assets/skills');await page.locator('[data-skill-editor]').waitFor();
    assert.equal(await page.locator('[name="markdown"]').inputValue(),unsaved);
    await page.locator('[data-skill-editor] button[type="submit"]').click();
    await page.getByText('草稿已保存，尚未发布。',{exact:true}).waitFor();
    assert.equal(readStore().skillLibrary[0].versions.length,0);
    await page.locator('[data-skill-action="preview"]').click();assert.equal(await page.locator('[data-skill-preview] img').count(),0);assert(await page.locator('.skill-markdown').textContent().then(t=>t.includes('检查清单')));
    await page.locator('[data-skill-action="publish"]').click();await page.getByText('请先勾选确认发布。',{exact:true}).waitFor();
    await page.locator('[data-skill-confirm]').check();await page.locator('[data-skill-action="publish"]').click();
    await page.getByText('版本已发布，实际文件已读回核验。',{exact:true}).waitFor();
    const first=readStore().skillLibrary[0].currentVersionId;
    await page.locator('[data-skill-case] [name="title"]').fill('缺证据');await page.locator('[data-skill-case] [name="input"]').fill('只有 PASS，没有文件。');await page.locator('[data-skill-case] [name="checks"]').fill('必须指出缺少文件证据。');
    await page.locator('[data-skill-case] button').click();await page.getByText('用例已保存，尚未启动成员。',{exact:true}).waitFor();assert.equal(executions,0);
    await page.locator('[data-skill-run] [name="taskId"]').selectOption('target');await page.locator('[data-skill-run] button').click();
    await page.locator('[data-skill-evaluate]').waitFor();assert.equal(executions,1);assert.equal(readStore().tasks[0].progress,15);
    await page.locator('[data-skill-evaluate] [name="evidence"]').fill('已指出缺少证据。');await page.locator('[data-skill-evaluate] button').click();await page.getByText('人工判断 · 检查通过',{exact:false}).waitFor();
    form=page.locator('[data-skill-editor]');const v1=await form.locator('[name="markdown"]').inputValue();await form.locator('[name="markdown"]').fill(v1+'\n补充版本二规则。');await form.locator('button[type="submit"]').click();await page.getByText('草稿已保存，尚未发布。',{exact:true}).waitFor();await page.locator('[data-skill-confirm]').check();await page.locator('[data-skill-action="publish"]').click();await page.getByText('版本已发布，实际文件已读回核验。',{exact:true}).waitFor();
    assert.equal(readStore().skillLibrary[0].versions.length,2);
    await page.locator('[data-skill-history]').selectOption(first);await page.locator('[data-skill-action="restore"]').click();await page.getByText('历史版本已载入草稿，确认发布后才替换生效版本。',{exact:true}).waitFor();assert.equal(readStore().skillLibrary[0].versions.length,2);assert.equal(await page.locator('[name="markdown"]').inputValue(),v1);
    const posts=writes.length;await page.reload();await page.locator('[data-skill-editor]').waitFor();await page.locator('[data-skill-action="refresh"]').click();assert.equal(writes.length,posts);assert.equal(executions,1);
    for(const theme of ['violet','warm','night','guofeng']) {
      await page.request.patch(base+'/api/meta',{data:{theme,language:'en'}});await page.reload();await page.getByRole('heading',{name:'Skill Studio',exact:true}).waitFor();await page.locator('[data-skill-editor]').waitFor();
      assert.equal(await page.locator('[data-skill-editor] [name="description"]').inputValue(),'Check real deliverables');
    }
    await page.setViewportSize({width:480,height:900});await page.locator('[data-skill-action="preview"]').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2));
    await page.screenshot({path:path.join(root,'skills-narrow-en.png'),fullPage:false});
    await page.setViewportSize({width:1440,height:1000});await page.request.patch(base+'/api/meta',{data:{language:'zh-CN'}});await page.reload();await page.locator('[data-skill-editor]').waitFor();
    await page.screenshot({path:path.join(root,'skills-guofeng.png'),fullPage:false});
    assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);assert.equal(readStore().tasks[0].title,'任务原文必须保留');
    console.log('Skill Studio browser: source-to-draft, navigation drafts, safe Markdown preview, explicit publication, version restore, test/evaluation contract, read-only refresh, EN/CN, four themes and narrow screen passed. Screenshots: '+root);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
