/**
 * Send a formatted alert card to a Google Chat webhook.
 * GOOGLE_CHAT_WEBHOOK must be set as a GitHub Actions secret (or .env locally).
 */

const WEBHOOK = process.env.GOOGLE_CHAT_WEBHOOK;

/**
 * Format a number with sign prefix (e.g. +2.3 or -1.5)
 */
function signed(n) {
  if (n === null || n === undefined) return "n/a";
  return (n > 0 ? "+" : "") + n;
}

/**
 * Format IVR with fire emoji
 */
function formatIVR(ivr) {
  if (ivr === null || ivr === undefined) return "n/a";
  const label = ivr.toFixed(0);
  if (ivr >= 75) return `${label} 🔥🔥`;
  if (ivr >= 50) return `${label} 🔥`;
  return label;
}

/**
 * Format PCR with directional label
 */
function formatPCR(pcr, pcrSignal) {
  if (pcr === null || pcr === undefined) return "n/a";
  const label = pcr.toFixed(2);
  if (pcrSignal === "CALL-HEAVY") return `${label} (call-heavy)`;
  if (pcrSignal === "PUT-HEAVY")  return `${label} (put-heavy)`;
  return label;
}

/**
 * Build the text body for a single signal card.
 */
function buildSignalBlock(s, divider) {
  const emoji   = s.direction === "CALL" ? "🟢" : "🔴";
  const action  = s.direction === "CALL"
    ? "Buy CALL (short-dated, 3-7 DTE)"
    : "Buy PUT  (short-dated, 3-7 DTE)";

  const scoreLabel = `${s.score > 0 ? "+" : ""}${s.score}`;
  const earningsBadge = s.isEarningsPlay ? "  🚨 EARNINGS PLAY" : "";

  const watchlistLabel = s.watchlists?.length
    ? s.watchlists.join(", ")
    : "—";

  const lines = [
    `${emoji} *${s.ticker}*  $${s.lastClose}  (${signed(s.dayChangePct)}%)${earningsBadge}`,
    `   Direction  : *${s.direction}*   Score: *${scoreLabel} / 10*`,
  ];

  if (s.isEarningsPlay && s.daysToEarnings !== null) {
    lines.push(`   🚨 Earnings : *${s.daysToEarnings} day(s) away* (${s.earningsNextDate})`);
  }

  lines.push(
    `   IVR        : ${formatIVR(s.ivr)}`,
    `   RSI        : ${s.rsi ?? "n/a"}`,
    `   MACD hist  : ${s.macd?.hist ?? "n/a"}`,
    `   Vol ratio  : ${s.volumeRatio ?? "n/a"}x`,
    `   5d trend   : ${signed(s.momentum5dPct)}%`,
    `   Beta / ATR : ${s.beta?.toFixed(1) ?? "n/a"} / ${s.atrPct?.toFixed(1) ?? "n/a"}%`,
    `   Put/Call   : ${formatPCR(s.pcr, s.pcrSignal)}`,
    `   Watchlists : ${watchlistLabel}`,
    `   Reasons    : ${s.reasons.join(" | ")}`,
    `   👉 ${action}`,
    divider,
  );

  return lines.join("\n");
}

/**
 * Send the ranked signal list to Google Chat.
 *
 * @param {Array}  signals  — ranked signal objects from scorer.js
 * @param {string} runTime  — human-readable run timestamp
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

  const divider = "─────────────────────────────";

  const callCount = signals.filter(s => s.direction === "CALL").length;
  const putCount  = signals.filter(s => s.direction === "PUT").length;

  const header = [
    `🔔 *Stock Scanner Alert* — ${runTime}`,
    `${signals.length} signal(s) found  |  🟢 ${callCount} CALL  🔴 ${putCount} PUT`,
    "_Ranked by composite score (technical + IVR + earnings + beta + options flow)_",
  ].join("\n");

  const blocks = signals.map(s => buildSignalBlock(s, divider));
  const text   = [header, divider, ...blocks].join("\n");

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

/**
 * Send verification results to Google Chat.
 */
export async function sendVerificationAlert(verificationData, runTime) {
  if (!WEBHOOK) return;
  if (!verificationData || verificationData.length === 0) return;

  const divider = "─────────────────────────────";
  
  const profitableCount = verificationData.filter(v => v.isProfitable).length;
  const winRate = ((profitableCount / verificationData.length) * 100).toFixed(0);

  const header = [
    `📊 *Intraday Verification Report* — ${runTime}`,
    `${verificationData.length} signal(s) verified | Win Rate: ${winRate}% (${profitableCount}/${verificationData.length})`,
    "_Performance measured from morning alert price to afternoon close_",
  ].join("\n");

  const blocks = verificationData.map(v => {
    const emoji = v.isProfitable ? "🏆" : "📉";
    const dirEmoji = v.direction === "CALL" ? "🟢" : "🔴";
    const returnStr = `${v.currentReturnPct > 0 ? "+" : ""}${v.currentReturnPct}%`;
    const excursionStr = `${v.maxFavorablePct > 0 ? "+" : ""}${v.maxFavorablePct}%`;
    
    return [
      `${emoji} ${dirEmoji} *${v.ticker}* (${v.direction})`,
      `   Entry Price : $${v.entryPrice.toFixed(2)}`,
      `   Current     : $${v.currentPrice.toFixed(2)}  *(Return: ${returnStr})*`,
      `   Max Excursion: ${excursionStr}  (High: $${v.intradayHigh?.toFixed(2) || "n/a"}, Low: $${v.intradayLow?.toFixed(2) || "n/a"})`,
      divider
    ].join("\n");
  });

  const text = [header, divider, ...blocks].join("\n");

  const res = await fetch(WEBHOOK, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.warn(`⚠️ Google Chat verification webhook failed: ${res.status} — ${body}`);
  } else {
    console.log(`📨 Verification alert sent to Google Chat`);
  }
}
