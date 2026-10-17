const fs = require("fs");
const assert = require("assert");

const css = fs.readFileSync("public/styles.css", "utf8");

function rule(selector) {
  const match = css.match(selector);
  assert(match, `Missing theme rule: ${selector}`);
  return match[0];
}

function color(block, name) {
  const match = block.match(new RegExp(`--${name}:(#[0-9a-fA-F]{6})`));
  assert(match, `Missing --${name}`);
  return match[1];
}

function luminance(hex) {
  const values = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = values.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const themes = [
  ["violet", rule(/^:root \{[^}]+\}/m)],
  ["warm", rule(/:root\[data-theme="warm"\] \{[^}]+\}/m)],
  ["night", rule(/:root\[data-theme="night"\] \{[^}]+\}/m)],
  ["guofeng", rule(/:root\[data-theme="guofeng"\] \{[^}]+\}/m)],
];

for (const [name, block] of themes) {
  const ratio = contrast(color(block, "side"), color(block, "side-ink"));
  assert(ratio >= 4.5, `${name} sidebar text contrast is ${ratio.toFixed(2)}:1; expected at least 4.5:1`);
}

const ink = themes.find(([name]) => name === 'guofeng')[1];
for (const [foreground, background] of [['ink','paper'],['muted','paper'],['muted','canvas'],['side-muted','side'],['accent-deep','side-sel'],['ok','paper'],['warn','warn-bg'],['danger','paper']]) {
  const ratio = contrast(color(ink, foreground), color(ink, background));
  assert(ratio >= 4.5, `guofeng ${foreground}/${background} contrast is ${ratio.toFixed(2)}:1`);
}
for (const background of ['accent','accent-deep','pink','hero-a','hero-b']) assert(contrast('#ffffff',color(ink,background)) >= 4.5, `guofeng white text on ${background} must be readable`);
console.log("Four theme sidebar checks and Chinese Ink & Jade text, buttons and status contrast passed.");
