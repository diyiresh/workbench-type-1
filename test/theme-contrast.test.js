const fs = require("fs");
const assert = require("assert");

const css = fs.readFileSync("public/v8-studio.css", "utf8");

function rule(selector) {
  const match = css.match(selector);
  assert(match, `Missing theme rule: ${selector}`);
  return match[0];
}

function color(block, name) {
  const match = block.match(new RegExp(`--${name}:(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})(?=[;}])`));
  assert(match, `Missing --${name}`);
  return match[1];
}

function luminance(hex) {
  if(hex.length===4) hex="#"+[...hex.slice(1)].map(c=>c+c).join("");
  const values = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = values.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const themes = ['studio','moonlit','porcelain','autumn'].map(name=>[name,rule(new RegExp(':root\\[data-v8="true"\\]\\[data-studio-palette="'+name+'"\\]\\{[^}]+\\}'))]);
for(const [name,block] of themes){
 for(const [foreground,background] of [['ink','side'],['muted','paper'],['ink','paper'],['accent-deep','accent-soft'],['ok','paper'],['warn','warn-bg'],['danger','paper']]){
  const ratio=contrast(color(block,foreground),color(block,background));
  assert(ratio>=4.5,`${name} ${foreground}/${background} contrast is ${ratio.toFixed(2)}:1`);
 }
}
assert(!fs.readFileSync('public/styles.css','utf8').includes('data-theme='),'Retired theme selectors are removed');
console.log('Four retained palettes: navigation, text, action and status contrast passed.');
