#!/usr/bin/env node
/**
 * monitor.mjs: a tiny website watchdog that pings your site and messages
 * you on Telegram when something breaks (and again when it recovers).
 *
 * It checks three things every time it runs:
 *   1. Is the site up?         (HTTP 200)
 *   2. Is the right page there? (a keyword you expect appears in the HTML)
 *   3. Is the HTTPS cert okay?  (warns if it expires within EXPIRY_WARN_DAYS)
 *
 * It only messages you when the status CHANGES. You get one "DOWN"
 * message, then silence until it's fixed, then one "RECOVERED" message.
 * No spam. It remembers the last status in state.json.
 *
 * No libraries to install. This uses only what Node 18+ ships with.
 *
 * Config comes from environment variables (see .env.example) OR config.json.
 * Env wins over config.json, so the cloud route can use GitHub Actions
 * Secrets and the local route can use a .env file.
 *
 * Dry run: if the Telegram token or chat ids are missing, alerts are printed
 * to the console instead of sent. Handy for trying it out with no bot.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import tls from "node:tls";

// ---- load .env if present (tiny parser; real env vars still win) -----------
if (existsSync("./.env")) {
  for (const line of readFileSync("./.env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const val = m[2].replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

// ---- load config (env first, then config.json as fallback) ----------------
let fileCfg = {};
if (existsSync("./config.json")) {
  try { fileCfg = JSON.parse(readFileSync("./config.json", "utf8")); } catch {}
}
const cfg = {
  url: process.env.MONITOR_URL || fileCfg.url,
  keyword: process.env.MONITOR_KEYWORD || fileCfg.keyword || "",
  botToken: process.env.TELEGRAM_BOT_TOKEN || fileCfg.botToken,
  // comma-separated list of chat ids (yours, and optionally a shared team chat)
  chatIds: (process.env.TELEGRAM_CHAT_IDS || fileCfg.chatIds || "")
    .toString().split(",").map((s) => s.trim()).filter(Boolean),
  expiryWarnDays: Number(process.env.EXPIRY_WARN_DAYS || fileCfg.expiryWarnDays || 10),
  statePath: process.env.STATE_PATH || "./state.json",
};

if (!cfg.url) {
  console.error("Missing config: MONITOR_URL (the site to watch, e.g. https://example.com)");
  process.exit(2);
}
// No token or no chat ids means dry run: print alerts instead of sending.
const dryRun = !cfg.botToken || cfg.chatIds.length === 0;
if (dryRun) console.log("Dry run: no Telegram token or chat id set, alerts will be printed only.");

// ---- helpers ---------------------------------------------------------------
async function sendTelegram(text) {
  if (dryRun) { console.log(`[dry run] would send:\n${text}`); return; }
  for (const chatId of cfg.chatIds) {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) console.error(`Telegram send failed for chat ${chatId}: ${body.description || res.status}`);
  }
}

/** Days until the TLS certificate for a https URL expires (null on error). */
function certDaysLeft(urlStr) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      if (u.protocol !== "https:") return resolve(null);
      const socket = tls.connect(
        { host: u.hostname, port: u.port || 443, servername: u.hostname, timeout: 10000 },
        () => {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) return resolve(null);
          const ms = new Date(cert.valid_to).getTime() - Date.now();
          resolve(Math.floor(ms / 86400000));
        }
      );
      socket.on("error", () => resolve(null));
      socket.on("timeout", () => { socket.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

function loadState() {
  if (!existsSync(cfg.statePath)) return { status: "unknown" };
  try { return JSON.parse(readFileSync(cfg.statePath, "utf8")); } catch { return { status: "unknown" }; }
}
function saveState(s) { writeFileSync(cfg.statePath, JSON.stringify(s, null, 2)); }

// ---- the check -------------------------------------------------------------
async function runCheck() {
  const reasons = [];
  let status = "up";

  // 1 + 2: fetch the page, check status and keyword
  try {
    const res = await fetch(cfg.url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (res.status !== 200) { status = "down"; reasons.push(`HTTP ${res.status}`); }
    else if (cfg.keyword) {
      const html = await res.text();
      if (!html.includes(cfg.keyword)) { status = "down"; reasons.push(`page loaded but "${cfg.keyword}" was missing`); }
    }
  } catch (e) {
    status = "down";
    reasons.push(`could not reach site: ${e.name === "TimeoutError" ? "timed out" : e.message}`);
  }

  // 3: cert expiry (a warning, not a hard down, unless already down)
  const days = await certDaysLeft(cfg.url);
  let certNote = "";
  if (days !== null && days <= cfg.expiryWarnDays) {
    certNote = `\n⚠️ HTTPS certificate expires in ${days} day(s). Renew it soon.`;
    if (status === "up") reasons.push(`cert expires in ${days}d`);
  }

  return { status, reasons, certNote, days };
}

// ---- main: compare to last status, message only on change ------------------
const prev = loadState();
const { status, reasons, certNote } = await runCheck();
const now = new Date().toISOString();

const changedToDown = status === "down" && prev.status !== "down";
const recovered = status === "up" && prev.status === "down";

if (changedToDown) {
  await sendTelegram(`🔴 DOWN: ${cfg.url}\n${reasons.join("; ")}\n${now}`);
  console.log(`ALERT sent: down (${reasons.join("; ")})`);
} else if (recovered) {
  await sendTelegram(`✅ RECOVERED: ${cfg.url} is back up.\n${now}`);
  console.log("ALERT sent: recovered");
} else {
  console.log(`no change (status=${status}${reasons.length ? ", " + reasons.join("; ") : ""})`);
}

// cert warning: send at most once per day even if status is unchanged
const lastCertWarn = prev.lastCertWarn ? Date.parse(prev.lastCertWarn) : 0;
if (certNote && Date.now() - lastCertWarn > 24 * 3600 * 1000) {
  await sendTelegram(`Heads up on ${cfg.url}:${certNote}`);
  prev.lastCertWarn = now;
  console.log("cert warning sent");
}

saveState({ status, ts: now, lastCertWarn: prev.lastCertWarn || null });
