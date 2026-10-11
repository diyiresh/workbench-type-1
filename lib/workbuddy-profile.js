"use strict";
const fs = require("fs");
const path = require("path");
function profile() {
  const local = process.env.LOCALAPPDATA;
  if (!local) throw new Error("LOCALAPPDATA is unavailable");
  const root = path.join(local, "BenWorkbench", "codebuddy-login");
  const source = path.join(local, "Programs", "WorkBuddy", "resources", "app.asar.unpacked", "cli", "product.json");
  const product = path.join(root, "workbench-product.json");
  const config = JSON.parse(fs.readFileSync(source, "utf8"));
  config.authentication.id = "ben-workbench-workbuddy";
  fs.mkdirSync(root, { recursive: true });
  const body = JSON.stringify(config, null, 2);
  if (!fs.existsSync(product) || fs.readFileSync(product, "utf8") !== body) fs.writeFileSync(product, body);
  const env = { ...process.env, ACC_PRODUCT_CONFIG_PATH: product };
  delete env.ACC_PRODUCT_CONFIG_V3;
  delete env.ACC_PRODUCT_CONFIG_V2;
  delete env.ACC_PRODUCT_CONFIG;
  delete env.CODEBUDDY_FORCE_HEADLESS_BUNDLE;
  delete env.CODEBUDDY_FORCE_LITE_WB_BUNDLE;
  return { root, product, env, entry: path.join(root, "node_modules", "@tencent-ai", "codebuddy-code", "bin", "codebuddy") };
}
module.exports = { profile };
