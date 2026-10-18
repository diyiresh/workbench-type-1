const fs=require('fs');
const acorn=require('acorn');
const files=['public/app.js','public/js/core.js','public/js/centers.js','public/js/views.js','public/js/archive-ui.js','public/js/help.js','public/js/delivery-ui.js','public/js/agenda-notes-ui.js','public/js/agenda-note-cleanup-ui.js',...fs.readdirSync('public/modules').filter(f=>f.endsWith('.js')).map(f=>'public/modules/'+f)];
const entries=acorn.parse(fs.readFileSync('public/js/translations.js','utf8'),{ecmaVersion:'latest',sourceType:'module'}).body[0].declaration.declarations[0].init.properties;
const translations=new Set(entries.map(p=>p.key.value));
files.push('public/js/skill-studio-ui.js');
files.push('public/js/execution-ui.js');
const needed=new Set();
const han=/[\u3400-\u9fff]/;
function add(value){if(han.test(value) && !/^[A-Z]:\\/.test(value))needed.add(value);}
function fragment(source){
  for(const part of source.split(/(<[^>]*>)/g)){
    const values=part.startsWith('<')?[...part.matchAll(/(?:placeholder|title|aria-label)=(['"])([\s\S]*?)\1/g)].map(m=>m[2]):[part];
    for(const value of values)for(const piece of value.split(/__WBVALUE_\d+__/g))add(piece.trim());
  }
}
function walk(node){
  if(!node?.type)return;
  if(node.type==='TaggedTemplateExpression'&&node.tag.name==='ui')fragment(node.quasi.quasis.map((q,i)=>(q.value.cooked||'')+(i<node.quasi.expressions.length?'__WBVALUE_'+i+'__':'')).join(''));
  if(node.type==='CallExpression'&&node.callee.name==='tr'&&node.arguments[0]?.type==='Literal')add(node.arguments[0].value);
  if(node.type==='CallExpression'&&node.callee.name==='systemFragment'&&node.arguments[0]?.type==='Literal')fragment(node.arguments[0].value);
  for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value?.type)walk(value);}
}
for(const file of files)walk(acorn.parse(fs.readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'module'}));
const missing=[...needed].filter(key=>!translations.has(key)).sort();
if(missing.length){console.log(JSON.stringify(missing,null,2));process.exitCode=1;}else console.log(`Translation coverage passed: ${needed.size} system strings.`);
