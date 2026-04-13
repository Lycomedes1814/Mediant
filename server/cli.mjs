#!/usr/bin/env node
// Mediant local server. Serves the built UI and a single Org file
// over localhost with read/write + change notifications.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HELP = `Usage: mediant <file.org> [options]

Serve the Mediant agenda UI against a local Org file.

Options:
  --port N        Port to listen on (default: 4242)
  --daemon        Fork to background and print the PID
  --help, -h      Show this message

Stop a daemonised instance with: kill <pid>
`;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { file: null, port: 4242, daemon: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--daemon") {
      args.daemon = true;
    } else if (a === "--port") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v <= 0 || v > 65535) die("--port requires a valid port number");
      args.port = v;
    } else if (a.startsWith("-")) {
      die(`Unknown option: ${a}\n\n${HELP}`);
    } else if (args.file === null) {
      args.file = a;
    } else {
      die(`Unexpected argument: ${a}`);
    }
  }
  if (!args.file) {
    console.error(HELP);
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const filePath = path.resolve(args.file);
if (!fs.existsSync(filePath)) die(`File not found: ${filePath}`);
try {
  const st = fs.statSync(filePath);
  if (!st.isFile()) die(`Not a regular file: ${filePath}`);
} catch (e) {
  die(`Cannot stat ${filePath}: ${e.message}`);
}

// Daemon mode: re-exec ourselves detached with the flag stripped and exit.
if (args.daemon && !process.env.MEDIANT_CHILD) {
  const childArgs = process.argv.slice(1).filter((a) => a !== "--daemon");
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, MEDIANT_CHILD: "1" },
  });
  child.unref();
  console.log(`mediant: started in background (pid ${child.pid})`);
  console.log(`mediant: http://localhost:${args.port}`);
  console.log(`mediant: stop with: kill ${child.pid}`);
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");
if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, "index.html"))) {
  die(`No build found at ${distDir}\nRun: npm run build`);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

const MAX_BODY_BYTES = 16 * 1024 * 1024;

let currentVersion = String(fs.statSync(filePath).mtimeMs);
const sseClients = new Set();

function broadcast(version) {
  for (const res of sseClients) {
    try { res.write(`data: ${version}\n\n`); } catch {}
  }
}

// Debounced file watcher. fs.watch can fire multiple times per write on
// some platforms; coalesce within 100ms and only broadcast on real mtime
// changes.
let watchTimer = null;
function startWatcher() {
  try {
    fs.watch(filePath, () => {
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        try {
          const m = String(fs.statSync(filePath).mtimeMs);
          if (m !== currentVersion) {
            currentVersion = m;
            broadcast(m);
          }
        } catch {}
      }, 100);
    });
  } catch (e) {
    console.warn(`mediant: file watch unavailable (${e.message}) — external edits won't push`);
  }
}
startWatcher();

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const resolved = path.resolve(distDir, "." + urlPath);
  if (!resolved.startsWith(distDir + path.sep) && resolved !== distDir) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/api/source" && req.method === "GET") {
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      currentVersion = String(fs.statSync(filePath).mtimeMs);
      console.log(`mediant: read  ${new Date().toISOString()}  ${data.length} bytes`);
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Version": currentVersion,
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch (e) {
      res.writeHead(500); res.end(`read failed: ${e.message}`);
    }
    return;
  }

  if (url === "/api/source" && req.method === "PUT") {
    try {
      const ifMatch = req.headers["if-match"];
      const onDisk = String(fs.statSync(filePath).mtimeMs);
      if (ifMatch && ifMatch !== onDisk) {
        res.writeHead(409, {
          "Content-Type": "text/plain",
          "X-Version": onDisk,
        });
        res.end("version mismatch");
        return;
      }
      const body = await readBody(req);
      fs.writeFileSync(filePath, body, "utf-8");
      currentVersion = String(fs.statSync(filePath).mtimeMs);
      console.log(`mediant: write ${new Date().toISOString()}  ${body.length} bytes`);
      res.writeHead(200, { "X-Version": currentVersion });
      res.end();
    } catch (e) {
      res.writeHead(500); res.end(`write failed: ${e.message}`);
    }
    return;
  }

  if (url === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`data: ${currentVersion}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => {
      try { res.write(": ping\n\n"); } catch {}
    }, 30000);
    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    return;
  }

  if (req.method === "GET") { serveStatic(req, res); return; }

  res.writeHead(405, { Allow: "GET, PUT" });
  res.end();
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") die(`Port ${args.port} is in use`);
  die(`server error: ${e.message}`);
});

server.listen(args.port, "127.0.0.1", () => {
  if (!process.env.MEDIANT_CHILD) {
    console.log(`mediant: serving ${filePath}`);
    console.log(`mediant: http://localhost:${args.port}`);
  }
});

function shutdown() {
  server.close(() => process.exit(0));
  // If connections linger (SSE), force-exit quickly.
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
