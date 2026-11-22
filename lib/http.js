"use strict";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

function send(res, code, body, headers) {
  let payload;
  if (Buffer.isBuffer(body)) payload = body;
  else if (typeof body === "string") payload = Buffer.from(body);
  else payload = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, code, obj) {
  send(res, code, obj, { "Content-Type": "application/json; charset=utf-8" });
}

function notFound(res) {
  sendJson(res, 404, { error: "not_found" });
}

function isLoopback(req) {
  const address = String((req.socket && req.socket.remoteAddress) || "").toLowerCase();
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

// Browsers send text/plain POSTs cross-site without a preflight; agents and CLIs send no Origin.
function crossSiteWrite(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return true;
  const origin = req.headers.origin;
  return Boolean(origin) && origin !== `http://${req.headers.host}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

module.exports = { MIME, send, sendJson, notFound, isLoopback, crossSiteWrite, readBody };
