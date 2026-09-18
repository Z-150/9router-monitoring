import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const BOT_DIR = "/root/9router-bot";
const ENV_FILE = path.join(BOT_DIR, ".env.token");
const LOG_FILE = path.join(BOT_DIR, "bot.log");
const SERVICE = "9router-bot.service";

// Telegram bot token format: <bot_id>:<35-char secret>
const TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

/**
 * GET /api/bot
 *
 * Status bot + petunjuk ambil token. Token itu sendiri TIDAK PERNAH
 * dikembalikan — hanya ada/tidaknya, dan 4 karakter pertama bot id
 * untuk membantu user memastikan token yang benar.
 */
export async function GET() {
  const [service, token, logTail] = await Promise.all([
    serviceStatus(),
    tokenStatus(),
    readLogTail(40),
  ]);

  return NextResponse.json({
    ok: true,
    service,
    token,
    logTail,
    steps: TOKEN_STEPS,
  });
}

/**
 * POST /api/bot  — aksi: simpan token, atau kontrol service.
 *
 * Body: { action: "save-token" | "start" | "stop" | "restart", token?: string }
 *
 * Token yang disimpan bersifat WRITE-ONLY: setelah ditulis ke .env.token,
 * nilai penuh tidak pernah bisa dibaca kembali lewat API ini.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body bukan JSON valid" }, { status: 400 });
  }

  const action = String(body?.action || "");

  switch (action) {
    case "save-token":
      return saveToken(body?.token);
    case "start":
      return controlService("start");
    case "stop":
      return controlService("stop");
    case "restart":
      return controlService("restart");
    default:
      return NextResponse.json(
        { ok: false, error: `Aksi tidak dikenal: ${action}` },
        { status: 400 }
      );
  }
}

// ── Token ──────────────────────────────────────────────────────────

async function saveToken(raw) {
  const token = String(raw || "").trim();

  if (!token) {
    return NextResponse.json({ ok: false, error: "Token kosong" }, { status: 400 });
  }
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Format token tidak valid. Seharusnya seperti 123456789:AAH... (angka, titik dua, lalu ±35 karakter).",
      },
      { status: 400 }
    );
  }

  // Verifikasi ke Telegram sebelum disimpan — jangan simpan token yang tidak hidup.
  const check = await verifyTelegramToken(token);
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: `Token ditolak Telegram: ${check.error}` },
      { status: 400 }
    );
  }

  try {
    fs.mkdirSync(BOT_DIR, { recursive: true });
    fs.writeFileSync(ENV_FILE, `TELEGRAM_BOT_TOKEN=${token}\n`, { mode: 0o600 });
    fs.chmodSync(ENV_FILE, 0o600);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Gagal menulis .env.token: ${e.message}` },
      { status: 500 }
    );
  }

  // Restart supaya token baru dipakai.
  const restarted = await controlService("restart", { raw: true });

  return NextResponse.json({
    ok: true,
    saved: true,
    botUsername: check.username || "",
    botName: check.name || "",
    restart: restarted,
  });
}

async function tokenStatus() {
  let exists = false;
  let botIdPrefix = "";
  let mode = "";

  try {
    const st = fs.statSync(ENV_FILE);
    mode = (st.mode & 0o777).toString(8).padStart(3, "0");
    const content = fs.readFileSync(ENV_FILE, "utf8");
    const m = /^TELEGRAM_BOT_TOKEN=(.+)$/m.exec(content);
    if (m && m[1].trim()) {
      exists = true;
      // Hanya 4 digit pertama bot id — sisa token tidak pernah keluar.
      botIdPrefix = m[1].trim().split(":")[0].slice(0, 4);
    }
  } catch {
    /* file belum ada */
  }

  return {
    exists,
    hint: exists ? `bot id ${botIdPrefix}••••` : "",
    file: ".env.token",
    mode,
    secure: mode === "600",
  };
}

async function verifyTelegramToken(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data?.ok) {
      return { ok: true, username: data.result?.username || "", name: data.result?.first_name || "" };
    }
    return { ok: false, error: data?.description || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e?.message || "Tidak bisa menghubungi Telegram" };
  }
}

// ── Service ────────────────────────────────────────────────────────

async function serviceStatus() {
  try {
    const { stdout } = await execFileAsync("systemctl", [
      "show",
      SERVICE,
      "--property=ActiveState,SubState,MainPID,ActiveEnterTimestamp,UnitFileState",
      "--no-pager",
    ]);

    const kv = {};
    for (const line of stdout.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
    }

    const pid = Number(kv.MainPID || 0);
    const active = kv.ActiveState === "active";

    return {
      installed: Boolean(kv.UnitFileState && kv.UnitFileState !== ""),
      active,
      state: kv.ActiveState || "unknown",
      subState: kv.SubState || "",
      pid: pid > 0 ? pid : null,
      since: kv.ActiveEnterTimestamp || "",
      enabled: kv.UnitFileState === "enabled",
    };
  } catch (e) {
    return {
      installed: false,
      active: false,
      state: "unavailable",
      subState: "",
      pid: null,
      since: "",
      enabled: false,
      error: e?.message || "systemctl tidak tersedia",
    };
  }
}

async function controlService(action, opts = {}) {
  try {
    await execFileAsync("systemctl", [action, SERVICE], { timeout: 30000 });
  } catch (e) {
    const msg = String(e?.stderr || e?.message || "gagal");
    if (!opts.raw) {
      return NextResponse.json({ ok: false, error: msg.trim() }, { status: 500 });
    }
    return { ok: false, error: msg.trim() };
  }

  await new Promise((r) => setTimeout(r, 1200));
  const status = await serviceStatus();

  if (!opts.raw) {
    return NextResponse.json({ ok: true, action, service: status });
  }
  return { ok: true, action, service: status };
}

// ── Log ────────────────────────────────────────────────────────────

async function readLogTail(lines = 100) {
  try {
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const all = content.split("\n").filter(Boolean);
    return all.slice(-lines);
  } catch {
    return [];
  }
}

// Panduan ambil token — ditampilkan di UI.
const TOKEN_STEPS = [
  { n: 1, text: "Buka Telegram, cari @BotFather, lalu kirim /newbot" },
  { n: 2, text: "Kasih nama bot (bebas), lalu username (harus diakhiri 'bot')" },
  { n: 3, text: "BotFather membalas token seperti 123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  { n: 4, text: "Copy token itu, tempel di kolom bawah, lalu Simpan" },
];
