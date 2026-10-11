const assert = require("assert");
const { EventEmitter } = require("events");
const { explorerArgsFor, openInExplorer } = require("../lib/local-opener");

const file = "D:\\work\\reports\\weekly.md";
const folder = "D:\\work\\reports";

assert.deepStrictEqual(
  explorerArgsFor(file, false),
  ["/select,", file],
  "A registered file should open Explorer and select the file, not open the file itself."
);
assert.deepStrictEqual(
  explorerArgsFor(folder, true),
  [folder],
  "A registered folder should open that folder directly."
);

(async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  let launched;
  await openInExplorer(file, false, (command, args, options) => {
    launched = { command, args, options };
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  assert.strictEqual(launched.command, "explorer.exe");
  assert.deepStrictEqual(launched.args, ["/select,", file]);
  assert.deepStrictEqual(launched.options, { stdio: "ignore" });

  console.log("Local Explorer targeting checks passed.");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
