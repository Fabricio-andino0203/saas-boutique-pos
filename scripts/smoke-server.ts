import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type Expectation = { pathname: string; status: number; needle: string | null };

const READY_TIMEOUT_MS = 120_000;

function parseExpectation(raw: string): Expectation {
  const equals = raw.indexOf("=");
  if (equals === -1) {
    throw new Error(`Expectativa inválida: ${raw} (formato /ruta=estado[:texto])`);
  }
  const rest = raw.slice(equals + 1);
  const colon = rest.indexOf(":");
  const status = Number(colon === -1 ? rest : rest.slice(0, colon));
  if (!Number.isInteger(status)) {
    throw new Error(`Estado HTTP inválido en la expectativa: ${raw}`);
  }
  return {
    pathname: raw.slice(0, equals),
    status,
    needle: colon === -1 ? null : rest.slice(colon + 1),
  };
}

async function waitUntilListening(baseUrl: string, state: { exited: boolean }): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.exited) {
      throw new Error("El servidor terminó antes de responder.");
    }
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) });
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`El servidor no respondió en ${READY_TIMEOUT_MS / 1000} segundos.`);
}

function stop(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function main(): Promise<void> {
  const [mode, port, ...rawExpectations] = process.argv.slice(2);
  if ((mode !== "start" && mode !== "dev") || !port || rawExpectations.length === 0) {
    throw new Error("Uso: smoke-server <start|dev> <puerto> <ruta=estado[:texto]>...");
  }
  const expectations = rawExpectations.map(parseExpectation);
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const state = { exited: false };
  const child = spawn(process.execPath, [nextBin, mode, "--port", port], {
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  child.on("exit", () => {
    state.exited = true;
  });
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitUntilListening(baseUrl, state);
    let failures = 0;
    for (const expectation of expectations) {
      const response = await fetch(`${baseUrl}${expectation.pathname}`, {
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.text();
      const statusOk = response.status === expectation.status;
      const needleOk = expectation.needle === null || body.includes(expectation.needle);
      const verdict = statusOk && needleOk ? "OK  " : "FAIL";
      console.log(`${verdict} ${expectation.pathname} -> ${response.status}`);
      if (!statusOk || !needleOk) {
        failures += 1;
      }
    }
    if (failures > 0) {
      process.exitCode = 1;
    }
  } finally {
    stop(child);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
