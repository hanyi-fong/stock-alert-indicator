/**
 * Send a formatted alert card to a Google Chat webhook.
 * GOOGLE_CHAT_WEBHOOK must be set as a GitHub Actions secret (or .env locally).
 */

const WEBHOOK = process.env.GOOGLE_CHAT_WEBHOOK;

/**
 * @param {Array} signals  array of signal objects from scanner
 * @param {string} runTime  ISO timestamp string
 */
export async function sendGoogleChatAlert(signals, runTime) {
  if (!WEBHOOK) {
    console.error("❌  GOOGLE_CHAT_WEBHOOK env var not set");
    return;
  }

  if (signals.length === 0) {
    console.log("✅  No signals today — skipping notification");
    return;
  }

  // ── Build message text ────────────────────────────────
  const header = `🔔 *Stock Scanner Alert* — ${runTime}\n${signals.length} signal(s) found\n`;
  const divider = "─────────────────────────────";

  const blocks = signals.map(s => {
    const emoji  = s.direction === "CALL" ? "🟢" : "🔴";
    const action = s.direction === "CALL"
      ? "Consider buying a CALL (DTE 1)"
      : "Consider buying a PUT  (DTE 1)";

    return [
      `${emoji} *${s.ticker}*  $${s.lastClose}  (${s.dayChangePct > 0 ? "+" : ""}${s.dayChangePct}%)`,
      `   Direction : *${s.direction}*`,
      `   Score     : ${s.score}`,
      `   RSI       : ${s.rsi ?? "n/a"}`,
      `   MACD hist : ${s.macd?.hist ?? "n/a"}`,
      `   Vol ratio : ${s.volumeRatio ?? "n/a"}x`,
      `   Reasons   : ${s.reasons.join(" | ")}`,
      `   👉 ${action}`,
      divider,
    ].join("\n");
  });

  const text = [header, divider, ...blocks].join("\n");

  // ── POST to webhook ───────────────────────────────────
  const res = await fetch(WEBHOOK, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Chat webhook failed: ${res.status} — ${body}`);
  }

  console.log(`📨  Alert sent to Google Chat (${signals.length} signal(s))`);
}

/**
 * Send a plain heartbeat message (useful for testing the webhook).
 */
export async function sendHeartbeat() {
  if (!WEBHOOK) return;
  await fetch(WEBHOOK, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text: "✅ Stock scanner is alive and running." }),
  });
}
