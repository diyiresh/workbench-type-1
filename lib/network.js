"use strict";
const http = require('node:http');
const { networkEnvironment } = require('./codex');
function proxyOptions(env) {
  return { HTTP_PROXY: env.HTTP_PROXY || env.http_proxy || '', HTTPS_PROXY: env.HTTPS_PROXY || env.https_proxy || '',
    NO_PROXY: [...new Set([...(env.NO_PROXY || env.no_proxy || '').split(',').filter(Boolean), 'localhost', '127.0.0.1', '::1'])].join(',') };
}
async function configureNetwork({ readEnvironment = networkEnvironment, apply = http.setGlobalProxyFromEnv } = {}) {
  const options = proxyOptions(await readEnvironment());
  if (typeof apply === 'function') apply(options);
  else if (options.HTTP_PROXY || options.HTTPS_PROXY) console.warn('当前 Node 不支持动态代理；请使用 Node 24.14+ 或通过 NODE_USE_ENV_PROXY=1 启动。');
}
module.exports = { configureNetwork, proxyOptions };
