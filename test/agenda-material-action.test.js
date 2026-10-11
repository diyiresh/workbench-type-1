const fs = require("fs");
const assert = require("assert");

const views = fs.readFileSync("public/js/views.js", "utf8");

assert.match(
  views,
  /data-act="agenda-open-material" data-id="\$\{esc\(item\.id\)\}" data-index="0"[^>]*>打开材料<\/button>/,
  "A scheduled item with material must expose a direct open action."
);
assert.match(
  views,
  /const editLabel = hasMaterials \? "编辑路径" : "添加材料"/,
  "Editing a path must remain separate from opening it."
);
assert.match(
  views,
  /data-act="agenda-materials" data-id="\$\{esc\(item\.id\)\}">\$\{editLabel\}<\/button>/,
  "The distinct edit action must keep its dynamic label."
);

console.log("Agenda material action checks passed.");
