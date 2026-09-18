"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import { cn } from "@/shared/utils/cn";
import { translate, onLocaleChange } from "@/i18n/runtime";

/**
 * useT — fungsi terjemahan yang REAKTIF terhadap pergantian locale.
 *
 * Pemindai text-node bawaan 9Router tidak menjangkau teks yang dihasilkan
 * JavaScript (template literal) maupun yang berada di dalam tombol ber-ikon,
 * jadi bagian itu harus lewat translate() manual — dan komponennya perlu
 * dirender ulang saat bahasa diganti agar nilainya ikut berubah.
 */
function useT() {
  const [, force] = useState(0);
  useEffect(() => {
    const unsub = onLocaleChange(() => force((n) => n + 1));
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);
  return translate;
}

const POLL_MS = 5000;

export default function BotPanel() {
  const t = useT();
  const [state, setState] = useState(null);
  const [err, setErr] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState(null);
  const [showSteps, setShowSteps] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bot", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Gagal memuat");
      setState(json);
      setErr("");
    } catch (e) {
      setErr(e?.message || "Gagal memuat status bot");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const act = useCallback(
    async (action, payload) => {
      setBusy(action);
      setToast(null);
      try {
        const res = await fetch("/api/bot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Gagal");
        if (action === "save-token") {
          setToken("");
          setToast({
            kind: "ok",
            text: `${t("Token saved")}${json.botUsername ? ` — @${json.botUsername}` : ""}. ${t("Bot restarted.")}`,
          });
        } else {
          setToast({ kind: "ok", text: `${t("Command")} ${action} ${t("executed.")}` });
        }
        await load();
      } catch (e) {
        setToast({ kind: "bad", text: e?.message || t("Failed") });
      } finally {
        setBusy("");
      }
    },
    [load]
  );

  const svc = state?.service || {};
  const tk = state?.token || {};
  const logs = state?.logTail || [];
  const steps = state?.steps || [];
  const running = Boolean(svc.active);
  const hasToken = Boolean(tk.exists);

  return (
    <Card padding="none">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <span className="material-symbols-outlined text-[18px] text-text-muted">
          smart_toy
        </span>
        <h2 className="text-sm font-semibold text-text-main">Telegram Bot</h2>
        <span
          className={cn(
            "ml-1 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold",
            running ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
          )}
        >
          <span
            className={cn("size-1.5 rounded-full", running ? "bg-green-500" : "bg-red-500")}
          />
          {running ? t("Running") : svc.installed ? t("Stopped") : t("Not installed")}
        </span>
        {svc.pid ? (
          <span className="text-xs text-text-muted">PID {svc.pid}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Toast */}
        {toast && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
              toast.kind === "ok"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-red-500/10 text-red-500"
            )}
          >
            <span className="material-symbols-outlined text-[16px]">
              {toast.kind === "ok" ? "check_circle" : "error"}
            </span>
            <span>{toast.text}</span>
          </div>
        )}
        {err && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
            <span className="material-symbols-outlined text-[16px]">warning</span>
            <span>{err}</span>
          </div>
        )}

        {/* Status token */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-text-muted">
            {t("Token")}:{" "}
            {hasToken ? (
              <span className="font-medium text-green-500">
                {t("installed")} {tk.hint ? `(${tk.hint})` : ""}
              </span>
            ) : (
              <span className="font-medium text-amber-500">{t("not set")}</span>
            )}
          </span>
          <span className="text-text-muted">
            {t("File")}: <code className="font-mono">{tk.file || ".env.token"}</code>
          </span>
          <span className={cn("text-text-muted", !tk.secure && hasToken && "text-amber-500")}>
            {t("Permission")}: <code className="font-mono">{tk.mode || "-"}</code>
            {hasToken && tk.secure ? " ✓" : ""}
          </span>
        </div>

        {/* Form token */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="bot-token" className="text-sm font-medium text-text-main">
              Bot Token
            </label>
            <button
              type="button"
              onClick={() => setShowSteps((v) => !v)}
              className="flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">help</span>
              How to get a token
            </button>
          </div>

          {showSteps && (
            <ol className="flex flex-col gap-1.5 rounded-lg bg-bg p-3">
              {steps.map((s) => (
                <li key={s.n} className="flex gap-2 text-xs text-text-muted">
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                    {s.n}
                  </span>
                  <span className="pt-px">{s.text}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Input
                id="bot-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={hasToken ? "••••••••••••••••••••  (type to replace)" : "123456789:AAH..."}
                autoComplete="off"
              />
            </div>
            <Button
              variant="primary"
              onClick={() => act("save-token", { token })}
              disabled={busy === "save-token" || !token.trim()}
            >
              {busy === "save-token" ? "Saving…" : "Save Token"}
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            {t("Token is written to")}{" "}
            <code className="font-mono">.env.token</code> {t("with")}{" "}
            <code className="font-mono">600</code> {t("permission and")}{" "}
            <strong>{t("cannot be read back")}</strong> {t("from this page.")}
          </p>
        </div>

        {/* Kontrol */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
          <Button
            variant="secondary"
            onClick={() => act("start")}
            disabled={busy !== "" || running || !hasToken}
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">play_arrow</span>
              {t("Start")}
            </span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => act("stop")}
            disabled={busy !== "" || !running}
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">stop</span>
              {t("Stop")}
            </span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => act("restart")}
            disabled={busy !== "" || !hasToken}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "material-symbols-outlined text-[16px]",
                  busy === "restart" && "animate-spin"
                )}
              >
                restart_alt
              </span>
              {t("Restart")}
            </span>
          </Button>
          <span className="ml-auto text-xs text-text-muted">
            {svc.since ? `${t("Active since")} ${svc.since}` : ""}
          </span>
        </div>
      </div>

      {/* Log */}
      <div className="border-t border-border-subtle">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="material-symbols-outlined text-[16px] text-text-muted">
            terminal
          </span>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t("Bot Log")}
          </h3>
          <span className="text-xs text-text-muted">
            {logs.length ? `${t("Last")} ${logs.length} ${t("lines")}` : ""}
          </span>
        </div>
        <div className="max-h-64 overflow-auto bg-bg px-4 py-3">
          {logs.length === 0 ? (
            <p className="text-xs text-text-muted">
              No logs yet. Logs appear after the bot runs via service.
            </p>
          ) : (
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-muted">
              {logs.join("\n")}
            </pre>
          )}
        </div>
      </div>
    </Card>
  );
}
