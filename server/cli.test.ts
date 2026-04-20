// @ts-nocheck

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const distIndex = path.join(distDir, "index.html");

let createdDistFixture = false;
const runningServers: Array<() => Promise<void>> = [];

beforeAll(async () => {
  if (!existsSync(distIndex)) {
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(distIndex, "<!doctype html><title>Mediant test fixture</title>\n", "utf-8");
    createdDistFixture = true;
  }
});

afterEach(async () => {
  while (runningServers.length > 0) {
    await runningServers.pop()!();
  }
});

afterAll(async () => {
  if (createdDistFixture) {
    await fs.rm(distDir, { recursive: true, force: true });
  }
});

describe("server/cli.mjs", () => {
  it("serves the source file with an X-Version header", async () => {
    const server = await startServer("** TODO First\n");
    const response = await fetch(server.url("/api/source"));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Version")).toBeTruthy();
    expect(await response.text()).toBe("** TODO First\n");
  });

  it("writes updates with If-Match and returns a new version", async () => {
    const server = await startServer("** TODO Before\n");
    const initial = await fetch(server.url("/api/source"));
    const version = initial.headers.get("X-Version");
    expect(version).toBeTruthy();

    const put = await fetch(server.url("/api/source"), {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "If-Match": version!,
      },
      body: "** TODO After\n",
    });

    expect(put.status).toBe(200);
    const nextVersion = put.headers.get("X-Version");
    expect(nextVersion).toBeTruthy();
    expect(nextVersion).not.toBe(version);

    const reread = await fetch(server.url("/api/source"));
    expect(await reread.text()).toBe("** TODO After\n");
    expect(reread.headers.get("X-Version")).toBe(nextVersion);
  });

  it("rejects stale If-Match writes with 409 and keeps the on-disk content", async () => {
    const server = await startServer("** TODO Original\n");
    const initial = await fetch(server.url("/api/source"));
    const staleVersion = initial.headers.get("X-Version");
    expect(staleVersion).toBeTruthy();

    await forceMtimeTick();
    await fs.writeFile(server.orgPath, "** TODO External\n", "utf-8");

    const put = await fetch(server.url("/api/source"), {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "If-Match": staleVersion!,
      },
      body: "** TODO Client write\n",
    });

    expect(put.status).toBe(409);
    const onDiskVersion = put.headers.get("X-Version");
    expect(onDiskVersion).toBeTruthy();
    expect(onDiskVersion).not.toBe(staleVersion);
    expect(await fs.readFile(server.orgPath, "utf-8")).toBe("** TODO External\n");
  });

  it("pushes SSE version updates when the org file changes externally", async () => {
    const server = await startServer("** TODO Watch me\n");
    const stream = await openEventStream(server.port, "/api/events");

    const initialVersion = await stream.nextEvent();
    expect(initialVersion).toBeTruthy();

    await forceMtimeTick();
    await fs.writeFile(server.orgPath, "** TODO Changed elsewhere\n", "utf-8");

    const changedVersion = await stream.nextEvent();
    expect(changedVersion).toBeTruthy();
    expect(changedVersion).not.toBe(initialVersion);

    await stream.close();
  });
});

async function startServer(initialSource: string): Promise<{
  port: number;
  orgPath: string;
  url: (pathname: string) => string;
}> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mediant-server-test-"));
  const orgPath = path.join(tmpDir, "agenda.org");
  await fs.writeFile(orgPath, initialSource, "utf-8");

  const port = await getFreePort();
  const proc = spawn(process.execPath, ["server/cli.mjs", orgPath, "--port", String(port)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServerReady(proc, port);

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    proc.kill("SIGTERM");
    await Promise.race([
      onceExit(proc),
      sleep(1_000),
    ]);
    if (proc.exitCode === null && !proc.killed) {
      proc.kill("SIGKILL");
      await onceExit(proc);
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  };
  runningServers.push(stop);

  return {
    port,
    orgPath,
    url: (pathname: string) => `http://127.0.0.1:${port}${pathname}`,
  };
}

function waitForServerReady(proc: ReturnType<typeof spawn>, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString("utf-8");
      if (stdout.includes(`http://localhost:${port}`)) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString("utf-8");
    };
    const onExit = (): void => {
      cleanup();
      reject(new Error(`server exited before becoming ready\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    };

    const cleanup = (): void => {
      proc.stdout?.off("data", onStdout);
      proc.stderr?.off("data", onStderr);
      proc.off("exit", onExit);
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for server on port ${port}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 5_000);

    proc.stdout?.on("data", onStdout);
    proc.stderr?.on("data", onStderr);
    proc.on("exit", onExit);
  });
}

function onceExit(proc: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve();
      return;
    }
    proc.once("exit", () => resolve());
  });
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a free port"));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function openEventStream(port: number, pathname: string): Promise<{
  nextEvent: () => Promise<string>;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: "127.0.0.1",
      port,
      path: pathname,
      headers: { Accept: "text/event-stream" },
    });

    req.on("response", (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`unexpected SSE status ${res.statusCode}`));
        return;
      }

      const queue: string[] = [];
      let pendingResolve: ((value: string) => void) | null = null;
      let pendingReject: ((error: Error) => void) | null = null;
      let buffer = "";

      const flush = (value: string): void => {
        if (pendingResolve) {
          const resolveNext = pendingResolve;
          pendingResolve = null;
          pendingReject = null;
          resolveNext(value);
        } else {
          queue.push(value);
        }
      };

      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        while (buffer.includes("\n\n")) {
          const splitAt = buffer.indexOf("\n\n");
          const rawEvent = buffer.slice(0, splitAt);
          buffer = buffer.slice(splitAt + 2);
          const dataLine = rawEvent
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (dataLine) {
            flush(dataLine.slice("data: ".length));
          }
        }
      });

      res.on("error", (error) => {
        if (pendingReject) pendingReject(error);
      });

      resolve({
        nextEvent: () => {
          if (queue.length > 0) return Promise.resolve(queue.shift()!);
          return new Promise((resolveNext, rejectNext) => {
            const timeout = setTimeout(() => {
              pendingResolve = null;
              pendingReject = null;
              rejectNext(new Error("timed out waiting for SSE event"));
            }, 4_000);
            pendingResolve = (value: string) => {
              clearTimeout(timeout);
              resolveNext(value);
            };
            pendingReject = (error: Error) => {
              clearTimeout(timeout);
              rejectNext(error);
            };
          });
        },
        close: async () => {
          req.destroy();
        },
      });
    });

    req.on("error", reject);
  });
}

async function forceMtimeTick(): Promise<void> {
  await sleep(25);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
