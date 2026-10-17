const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'public','vendor'),{recursive:true});
for(const [file,contents] of [['workbench.js',"export { default as i18next } from 'i18next';"],['mermaid.js',"export { default } from 'mermaid';"],['markdown.js',"export { default } from 'markdown-it';"]]) {
  const result=esbuild.buildSync({stdin:{contents,resolveDir:root},bundle:true,format:'esm',minify:true,outfile:path.join(root,'public','vendor',file),legalComments:'linked',write:false});
  for(const output of result.outputFiles){
    const bytes=Buffer.from(output.contents);
    if(fs.existsSync(output.path)&&fs.readFileSync(output.path).equals(bytes))continue;
    const temporary=output.path+'.tmp';fs.writeFileSync(temporary,bytes);fs.renameSync(temporary,output.path);
  }
}
console.log('Local browser assets built.');
