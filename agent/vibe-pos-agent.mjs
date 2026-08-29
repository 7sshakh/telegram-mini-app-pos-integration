#!/usr/bin/env node
/**
 * VIBE POS bridge agent
 * ---------------------------------------------------------------------------
 * Runs on the same computer as the VIBE Electron POS. It is the ONLY thing
 * allowed to talk to the local POS adapter (127.0.0.1) and it is the ONLY
 * thing the cloud needs to trust.
 *
 *            Telegram Mini App  ->  cloud API (Postgres queue)
 *                                        ^        |
 *                                        |        v
 *                              this agent (long poll)
 *                                        |
 *                                        v
 *                     Electron POS main process (127.0.0.1:8787)
 *                                        |
 *                                        v
 *                              POS SQLite database  (source of truth)
 *
 * - No local port is ever exposed to the internet.
 * - Orders are queued in the cloud while this computer is offline and are
 *   delivered automatically when it comes back.
 * - Every order carries an idempotency key, so retries never duplicate orders.
 *
 * Usage:  node agent/vibe-pos-agent.mjs
 * Config: environment variables or agent/agent.config.json
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

// ---------------------------------------------------------------- config ----
const fileConfig = (() => {
  const candidates = [
    path.join(process.cwd(), "agent.config.json"),
    path.join(process.cwd(), "agent", "agent.config.json"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (error) {
        console.error("[agent] agent.config.json is not valid JSON:", error.message);
      }
    }
  }
  return {};
})();

const env = { ...fileConfig, ...process.env };

const config = {
  cloudUrl: (env.CLOUD_URL || env.AGENT_CLOUD_URL || "http://localhost:3000").replace(/\/$/, ""),
  posUrl: (env.POS_URL || env.AGENT_POS_URL || "http://127.0.0.1:8787").replace(/\/$/, ""),
  posToken: env.POS_TOKEN || env.AGENT_POS_TOKEN || "",
  deviceId: env.DEVICE_ID || env.AGENT_DEVICE_ID || "",
  deviceSecret: env.DEVICE_SECRET || env.AGENT_DEVICE_SECRET || "",
  name: env.AGENT_NAME || os.hostname() || "VIBE-POS",
  catalogIntervalMs: Number(env.CATALOG_INTERVAL_MS || 60_000),
  statusIntervalMs: Number(env.STATUS_INTERVAL_MS || 15_000),
  claimWaitSeconds: Number(env.CLAIM_WAIT_SECONDS || 25),
  agentVersion: "1.0.0",
};

const tokenFile = path.join(process.cwd(), ".agent-token.json");

// ---------------------------------------------------------------- logging ---
const log = (...args) => console.log(new Date().toISOString(), ...args);
const logError = (...args) => console.error(new Date().toISOString(), "[error]", ...args);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ utils ---
async function fetchJson(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-agent-version": config.agentVersion,
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    const data = text ? safeJson(text) : null;
    return { status: response.status, ok: response.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

// ------------------------------------------------------------ registration --
let agentToken = null;
let cloudConfig = {};

function loadCachedToken() {
  try {
    if (fs.existsSync(tokenFile)) {
      const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
      if (parsed.agentToken) agentToken = parsed.agentToken;
    }
  } catch {
    // ignore
  }
}

function cacheToken() {
  try {
    fs.writeFileSync(tokenFile, JSON.stringify({ agentToken, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch {
    // ignore
  }
}

async function register() {
  const fingerprint = `${os.hostname()}:${os.platform()}:${os.arch()}`;
  const { status, ok, data } = await fetchJson(`${config.cloudUrl}/api/bridge/register`, {
    method: "POST",
    body: JSON.stringify({
      deviceId: config.deviceId,
      deviceSecret: config.deviceSecret,
      name: config.name,
      fingerprint,
      agentVersion: config.agentVersion,
    }),
  });

  if (!ok || !data?.agentToken) {
    throw new Error(`registration failed (${status}): ${JSON.stringify(data)}`);
  }

  agentToken = data.agentToken;
  cloudConfig = data;
  cacheToken();
  log("registered device", config.deviceId, "poll", data.pollSeconds, "s");
  return agentToken;
}

async function ensureToken() {
  if (agentToken) return agentToken;
  await register();
  return agentToken;
}

async function cloud(pathname, options = {}, timeoutMs = 30_000) {
  await ensureToken();
  const response = await fetchJson(`${config.cloudUrl}${pathname}`, {
    ...options,
    headers: { ...(options.headers || {}), authorization: `Bearer ${agentToken}` },
  }, timeoutMs);
  if (response.status === 401) {
    // token rotated or revoked -> register again and retry once
    agentToken = null;
    await register();
    return fetchJson(`${config.cloudUrl}${pathname}`, {
      ...options,
      headers: { ...(options.headers || {}), authorization: `Bearer ${agentToken}` },
    }, timeoutMs);
  }
  return response;
}

// ----------------------------------------------------------- POS adapter ----
async function pos(pathname, options = {}) {
  return fetchJson(`${config.posUrl}${pathname}`, {
    ...options,
    headers: { ...(options.headers || {}), "x-pos-token": config.posToken },
  });
}

async function posHealthy() {
  try {
    const response = await pos("/internal/health", {}, 4000);
    return response.ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------- catalog syncing ----
async function pushCatalog() {
  const menu = await pos("/internal/menu", {}, 15_000);
  if (!menu.ok) throw new Error(`POS menu unavailable (${menu.status})`);
  const body = { catalog: menu.data.catalog, promotions: menu.data.promotions || [] };
  const response = await cloud("/api/bridge/push/catalog", {
    method: "POST",
    body: JSON.stringify(body),
  }, 30_000);
  if (!response.ok) throw new Error(`catalog push failed (${response.status}): ${JSON.stringify(response.data)}`);
  log("catalog pushed:", menu.data.catalog?.products?.length, "products");
}

// ---------------------------------------------------------- order syncing ---
async function handleJob(job) {
  if (job.type === "CREATE_ORDER") {
    const payload = job.payload || {};
    const response = await pos("/internal/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    }, 25_000);

    if (response.ok && response.data?.ok) {
      await reportJob(job.id, {
        ok: true,
        posOrderId: String(response.data.orderId ?? ""),
        posOrderNumber: String(response.data.orderNumber ?? ""),
        status: response.data.status || "accepted",
      });
      log(`order ${payload.orderNumber} -> POS ${response.data.orderNumber ?? response.data.orderId}`);
      return;
    }

    // POS refused the order (price mismatch, out of stock, ...) -> do not retry blindly
    const message = response.data?.message || response.data?.error || `HTTP ${response.status}`;
    const fatal = response.status === 422 || response.status === 400;
    await reportJob(job.id, { ok: false, error: String(message).slice(0, 400), fatal });
    logError(`order ${payload.orderNumber} rejected by POS:`, message);
    return;
  }

  if (job.type === "CANCEL_ORDER") {
    const payload = job.payload || {};
    const response = await pos(`/internal/orders/${encodeURIComponent(payload.posOrderId || payload.orderId)}/cancel`, {
      method: "POST",
      body: JSON.stringify(payload),
    }, 15_000);
    await reportJob(job.id, { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` });
    return;
  }

  if (job.type === "REFRESH_CATALOG") {
    await pushCatalog();
    await reportJob(job.id, { ok: true });
    return;
  }

  if (job.type === "PING") {
    await reportJob(job.id, { ok: true });
    return;
  }

  await reportJob(job.id, { ok: false, error: `unknown job type ${job.type}`, fatal: true });
}

async function reportJob(jobId, result) {
  const response = await cloud(`/api/bridge/jobs/${jobId}/result`, {
    method: "POST",
    body: JSON.stringify(result),
  }, 15_000);
  if (!response.ok) {
    logError(`failed to report job ${jobId}:`, response.status, JSON.stringify(response.data));
  }
}

async function claimLoop() {
  for (;;) {
    if (stopping) return;
    try {
      const response = await cloud(
        `/api/bridge/jobs/claim?wait=${config.claimWaitSeconds}`,
        { method: "POST", body: JSON.stringify({}) },
        (config.claimWaitSeconds + 15) * 1000,
      );
      if (!response.ok) {
        logError("claim failed", response.status, JSON.stringify(response.data));
        await sleep(5000);
        continue;
      }
      const jobs = response.data?.jobs || [];
      for (const job of jobs) {
        try {
          await handleJob(job);
        } catch (error) {
          logError("job failed", job.type, error.message);
          await reportJob(job.id, { ok: false, error: error.message.slice(0, 400) }).catch(() => undefined);
        }
      }
    } catch (error) {
      logError("claim loop error:", error.message);
      await sleep(5000);
    }
  }
}

// ------------------------------------------------------- status streaming ---
let lastStatusSync = new Date(Date.now() - 60_000).toISOString();

async function pushStatuses() {
  const response = await pos(`/internal/orders/changed?since=${encodeURIComponent(lastStatusSync)}`, {}, 10_000);
  if (!response.ok || !Array.isArray(response.data?.orders)) return;
  for (const order of response.data.orders) {
    const push = await cloud("/api/bridge/push/order-status", {
      method: "POST",
      body: JSON.stringify({
        posOrderId: String(order.posOrderId ?? order.id),
        orderId: order.cloudOrderId || undefined,
        status: order.status,
        note: order.statusNote || null,
      }),
    }, 10_000);
    if (push.ok) {
      log("status pushed:", order.orderNumber || order.id, "->", order.status);
    } else if (push.status !== 404) {
      logError("status push failed", push.status, JSON.stringify(push.data));
    }
  }
  if (response.data.orders.length > 0) {
    lastStatusSync = response.data.orders[response.data.orders.length - 1].changedAt || new Date().toISOString();
  }
}

async function heartbeat() {
  for (;;) {
    if (stopping) return;
    try {
      const response = await cloud("/api/bridge/heartbeat", { method: "POST", body: "{}" }, 10_000);
      if (response.ok) {
        const pending = response.data?.pending ?? 0;
        if (pending > 0) log("pending jobs in cloud queue:", pending);
      }
    } catch (error) {
      logError("heartbeat failed:", error.message);
    }
    await sleep(30_000);
  }
}

async function catalogLoop() {
  for (;;) {
    if (stopping) return;
    if (await posHealthy()) {
      try {
        await pushCatalog();
      } catch (error) {
        logError("catalog sync failed:", error.message);
      }
    } else {
      log("POS adapter offline — waiting (orders stay queued in the cloud)");
    }
    await sleep(config.catalogIntervalMs);
  }
}

async function statusLoop() {
  for (;;) {
    if (stopping) return;
    if (await posHealthy()) {
      try {
        await pushStatuses();
      } catch (error) {
        logError("status sync failed:", error.message);
      }
    }
    await sleep(config.statusIntervalMs);
  }
}

// ------------------------------------------------------------------- main ---
let stopping = false;

async function main() {
  log("VIBE POS bridge agent starting");
  log("cloud:", config.cloudUrl, "| pos:", config.posUrl);

  if (!config.deviceId || !config.deviceSecret) {
    console.error(
      "\n[agent] DEVICE_ID / DEVICE_SECRET missing.\n" +
        "  1) Create a device:  curl -X POST $CLOUD/api/admin/devices -H 'x-admin-token: $ADMIN_API_TOKEN' -d '{\"name\":\"VIBE-POS-1\"}' -H 'content-type: application/json'\n" +
        "  2) Copy device_id + device_secret into agent/agent.config.json or the environment.\n",
    );
    process.exit(1);
  }

  loadCachedToken();
  await ensureToken();

  const healthy = await posHealthy();
  log("POS adapter:", healthy ? "online" : "offline (retrying)");

  await Promise.all([claimLoop(), heartbeat(), catalogLoop(), statusLoop()]);
}

process.on("SIGINT", () => {
  log("stopping…");
  stopping = true;
  setTimeout(() => process.exit(0), 500);
});

main().catch((error) => {
  logError("fatal:", error.message);
  process.exit(1);
});
