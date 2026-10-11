const fs = require("fs");
const assert = require("assert");

const script = fs.readFileSync("start.bat", "utf8");

assert.match(script, /工作台已经在运行/, "The launcher must identify an existing healthy workbench.");
assert.match(script, /端口 3780 已被其他程序占用/, "The launcher must distinguish a port conflict from a missing Node.js installation.");
assert.match(script, /where node/, "The launcher must still give a useful message when Node.js is absent.");
assert.match(script, /curl\.exe -fsS --max-time 2/, "The health check must remain safe for cmd.exe parsing.");

console.log("Start-script behavior checks passed.");
