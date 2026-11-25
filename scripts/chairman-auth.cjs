'use strict';
// Run by the human operator in a terminal. Agents must not enroll on their behalf.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
async function hidden(label){
  process.stdout.write(label);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';const onKey=(str,key={})=>{
      if(key.ctrl&&key.name==='c'){finish();reject(Error('cancelled'));}
      else if(key.name==='return'){finish();resolve(value);}
      else if(key.name==='backspace')value=value.slice(0,-1);
      else if(!key.ctrl&&!key.meta&&str&&!/[\x00-\x1f\x7f]/.test(str))value+=str;
    };
    function finish(){process.stdin.off('keypress',onKey);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
    process.stdin.on('keypress',onKey);
  });
}
(async()=>{
  if(process.argv[2]!=='setup'||!process.stdin.isTTY)throw Error('Open a terminal and run: node scripts/chairman-auth.cjs setup');
  const file=path.join(process.env.BENCH_DATA_DIR||path.resolve(__dirname,'../data'),'chairman-auth.json');
  if(fs.existsSync(file))throw Error('Approval credential already exists; enrollment will not overwrite it.');
  readline.emitKeypressEvents(process.stdin);
  const first=await hidden('Choose an approval passphrase (12+ characters, input hidden): '),second=await hidden('Repeat: ');
  if(first!==second)throw Error('Passphrases differ; nothing saved.');
  const record=await require('../lib/chairman-auth').credential(first);
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(record),{flag:'wx',mode:0o600});
  console.log('Approval credential configured. Never paste this passphrase into an Agent chat.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
