import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE_DIR = "D:\\work\\new_work\\work2_trae\\.edge-debug";
const DEBUG_PORT = 9227;
const TARGET_URL = "http://127.0.0.1:8765/index.html";
const OUTPUT = "D:\\work\\new_work\\work2_trae\\debug_page_output.json";

if (!existsSync(PROFILE_DIR)) {
  mkdirSync(PROFILE_DIR, { recursive: true });
}

const edge = spawn(
  EDGE,
  [
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-crash-reporter",
    "--no-sandbox",
    `--user-data-dir=${PROFILE_DIR}`,
    TARGET_URL
  ],
  { stdio: "ignore", windowsHide: true }
);

async function main() {
  let version;
  for (let i = 0; i < 20; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      version = await res.json();
      if (version?.webSocketDebuggerUrl) {
        break;
      }
    } catch {}
    await delay(500);
  }

  if (!version?.webSocketDebuggerUrl) {
    throw new Error("Unable to connect to Edge browser debugging endpoint.");
  }

  const browserWs = new WebSocket(version.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const consoleEvents = [];
  const pageEvents = [];
  let pageSessionId = null;

  browserWs.onmessage = (event) => {
    const payload = JSON.parse(event.data.toString());

    if (payload.id && pending.has(payload.id)) {
      pending.get(payload.id)(payload);
      pending.delete(payload.id);
      return;
    }

    if (payload.method === "Target.attachedToTarget") {
      pageSessionId = payload.params.sessionId;
      return;
    }

    if (payload.sessionId === pageSessionId) {
      if (payload.method === "Runtime.consoleAPICalled") {
        consoleEvents.push(payload.params);
      }

      if (payload.method === "Runtime.exceptionThrown") {
        consoleEvents.push({ type: "exception", exceptionDetails: payload.params.exceptionDetails });
      }

      if (payload.method === "Page.loadEventFired") {
        pageEvents.push(payload.method);
      }
    }
  };

  await new Promise((resolve, reject) => {
    browserWs.onopen = resolve;
    browserWs.onerror = reject;
  });

  const send = (method, params = {}, sessionId = null) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      const message = { id, method, params };
      if (sessionId) {
        message.sessionId = sessionId;
      }
      browserWs.send(JSON.stringify(message));
    });

  const targetsResponse = await send("Target.getTargets");
  const targets = targetsResponse.result?.targetInfos ?? [];
  const pageTarget = targets.find((target) => target.url === TARGET_URL) || targets.find((target) => target.type === "page");

  if (!pageTarget?.targetId) {
    throw new Error("Unable to find page target.");
  }

  await send("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });

  for (let i = 0; i < 10; i += 1) {
    if (pageSessionId) {
      break;
    }
    await delay(300);
  }

  if (!pageSessionId) {
    throw new Error("Unable to attach to page target.");
  }

  await send("Runtime.enable", {}, pageSessionId);
  await send("Page.enable", {}, pageSessionId);
  await send("Page.reload", { ignoreCache: true }, pageSessionId);
  await delay(4000);

  const evalResult = await send(
    "Runtime.evaluate",
    {
      expression: `(() => ({
        title: document.title,
        levelCards: document.querySelectorAll('.level-card').length,
        paletteCards: document.querySelectorAll('.component-card--palette').length,
        boardComponents: document.querySelectorAll('.board-component').length,
        activeComponentsText: document.querySelector('#active-components')?.innerText || '',
        wiringStatus: document.querySelector('#wiring-status')?.textContent || '',
        bodyText: document.body?.innerText?.slice(0, 500) || ''
      }))()`,
      returnByValue: true
    },
    pageSessionId
  );

  writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        pageEvents,
        consoleEvents,
        evaluation: evalResult.result?.result?.value ?? null
      },
      null,
      2
    ),
    "utf8"
  );

  browserWs.close();
  edge.kill();
}

main().catch((error) => {
  writeFileSync(OUTPUT, JSON.stringify({ error: String(error) }, null, 2), "utf8");
  edge.kill();
  process.exitCode = 1;
});
