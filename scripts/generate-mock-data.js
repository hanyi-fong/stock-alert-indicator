import fs from 'fs';
import path from 'path';

const isLocalTest = process.env.GITHUB_ACTIONS !== "true";
const docsDir = path.join(process.cwd(), isLocalTest ? "local" : "docs");
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const docsDataPath = path.join(docsDir, "data.json");

// Global defaults (can be overridden per track in the UI)
const DEFAULT_TARGET_PCT = 30;
const DEFAULT_STOP_LOSS_PCT = 30;
const DEFAULT_EXPIRY_DAYS = 10;
const MAX_TRACK_DAYS = 20;

/**
 * Walk back `n` business days from today to find a past trading date.
 */
function businessDaysAgo(n) {
  const date = new Date();
  let remaining = n;
  while (remaining > 0) {
    date.setDate(date.getDate() - 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return date;
}

/**
 * Generate up to MAX_TRACK_DAYS of daily OHLCV data for a trade.
 * The price follows a bumpy random walk toward `trajectory` over `totalDays`.
 * We always collect all days; we compute triggerDay separately.
 *
 * @param {string} ticker
 * @param {string} direction CALL|PUT
 * @param {number} startPrice
 * @param {number} daysAgo   how many business days ago the trade was detected
 * @param {number} trajectory overall % move of the underlying over `totalDays`
 * @param {number} totalDays  how many days of data to generate (≤ MAX_TRACK_DAYS)
 * @param {number} targetPct  default target for computing triggerDay
 * @param {number} stopPct    default stop for computing triggerDay
 * @param {number} expiryDays default expiry for computing triggerDay
 * @param {object} opts       optional volatility and extra overrides
 */
function buildTrack({
  ticker,
  direction,
  startPrice,
  daysAgo,
  trajectory,
  totalDays,
  targetPct = DEFAULT_TARGET_PCT,
  stopPct = DEFAULT_STOP_LOSS_PCT,
  expiryDays = DEFAULT_EXPIRY_DAYS,
  score = 8.5,
  isEarningsPlay = false,
  volatility = 8,
}) {
  const detectedDate = businessDaysAgo(daysAgo);
  const trackId = `${ticker}_${direction}_${detectedDate.getTime()}`;

  const dailyChanges = [];
  let currentPrice = startPrice;
  let maxExcursionPct = 0;
  let status = "OPEN";
  let exitReason = null;
  let triggerDay = null;
  let daysHeld = 0;

  for (let i = 0; i < totalDays; i++) {
    // Bumpy random walk toward trajectory
    const trendPerDay = trajectory / totalDays;
    const noise = (Math.random() * volatility) - (volatility / 2);
    const dailyChangePct = trendPerDay + noise;
    currentPrice = currentPrice * (1 + (dailyChangePct / 100));

    // Simulate intraday high/low around close
    const intradaySpread = Math.abs(noise) * 0.6;
    const high = currentPrice * (1 + intradaySpread / 100);
    const low = currentPrice * (1 - intradaySpread / 100);

    // Compute performance relative to start
    let pctChange, dayMaxPct, dayMinPct;
    if (direction === "CALL") {
      pctChange = ((currentPrice - startPrice) / startPrice) * 100;
      dayMaxPct = ((high - startPrice) / startPrice) * 100;
      dayMinPct = ((low - startPrice) / startPrice) * 100;
    } else {
      pctChange = ((startPrice - currentPrice) / startPrice) * 100;
      dayMaxPct = ((startPrice - low) / startPrice) * 100;
      dayMinPct = ((startPrice - high) / startPrice) * 100;
    }

    if (dayMaxPct > maxExcursionPct) maxExcursionPct = dayMaxPct;

    // Get the business date for this day
    const date = businessDaysAgo(daysAgo - i - 1);

    dailyChanges.push({
      day: i,
      date: date.toISOString().split('T')[0],
      close: parseFloat(currentPrice.toFixed(2)),
      pctChange: parseFloat(pctChange.toFixed(2)),
    });

    // Compute trigger (first occurrence only)
    if (triggerDay === null) {
      const hitTarget = dayMaxPct >= targetPct;
      const hitStop = dayMinPct <= -stopPct;

      if (hitTarget && hitStop) {
        status = "LOSS";
        exitReason = "STOP_LOSS";
        triggerDay = i;
      } else if (hitTarget) {
        status = "WIN";
        exitReason = "TARGET_PROFIT";
        triggerDay = i;
      } else if (hitStop) {
        status = "LOSS";
        exitReason = "STOP_LOSS";
        triggerDay = i;
      }

      if (triggerDay === null && (i + 1) >= expiryDays) {
        status = pctChange > 0 ? "WIN" : "LOSS";
        exitReason = "TIME_EXPIRED";
        triggerDay = i;
      }
    }
  }

  daysHeld = triggerDay !== null ? triggerDay + 1 : totalDays;

  return {
    trackId,
    ticker,
    direction,
    score,
    isEarningsPlay,
    dateDetected: detectedDate.toISOString(),
    startPrice: parseFloat(startPrice.toFixed(2)),
    dailyChanges,
    maxExcursionPct: parseFloat(maxExcursionPct.toFixed(2)),
    defaultTargetPct: targetPct,
    defaultStopLossPct: stopPct,
    defaultExpiryDays: expiryDays,
    status,
    daysHeld,
    exitReason,
    triggerDay,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Scenarios
// ─────────────────────────────────────────────────────────────────────────────

const mockTracks = [

  // ── SCENARIO 1: AAPL CALL — Clear WIN (target hit day 4)
  // Concurrent with Scenario 2 (same ticker, different direction)
  buildTrack({
    ticker: "AAPL", direction: "CALL", startPrice: 150,
    daysAgo: 18, trajectory: 35, totalDays: 18,
    targetPct: 30, stopPct: 30, expiryDays: 10,
    score: 9.0,
  }),

  // ── SCENARIO 2: AAPL PUT — OPEN doing poorly (same time as CALL above)
  // Tests: same ticker, different direction, simultaneous open trades
  buildTrack({
    ticker: "AAPL", direction: "PUT", startPrice: 150,
    daysAgo: 18, trajectory: 5, totalDays: 5,
    targetPct: 30, stopPct: 30, expiryDays: 10,
    score: 7.5,
  }),

  // ── SCENARIO 3: TSLA CALL — Stop Loss hit day 3 (first trade)
  buildTrack({
    ticker: "TSLA", direction: "CALL", startPrice: 200,
    daysAgo: 15, trajectory: -35, totalDays: 15,
    targetPct: 30, stopPct: 30, expiryDays: 10,
    score: 8.0,
  }),

  // ── SCENARIO 4: TSLA CALL — New entry after first trade closed (sequential)
  // Tests: same ticker, same direction, sequential (non-overlapping) trades
  (() => {
    // Start 8 days ago (after Scenario 3 was already stopped out)
    const t = buildTrack({
      ticker: "TSLA", direction: "CALL", startPrice: 185,
      daysAgo: 8, trajectory: 20, totalDays: 8,
      targetPct: 30, stopPct: 30, expiryDays: 10,
      score: 8.5,
    });
    // Make trackId distinct by adjusting a tiny bit in epoch (they're different daysAgo so already different)
    return t;
  })(),

  // ── SCENARIO 5: NVDA CALL — OPEN, doing well (8 days in)
  buildTrack({
    ticker: "NVDA", direction: "CALL", startPrice: 400,
    daysAgo: 8, trajectory: 18, totalDays: 8,
    targetPct: 30, stopPct: 30, expiryDays: 10,
    score: 9.5,
  }),

  // ── SCENARIO 6: AMD CALL — OPEN, doing poorly (5 days in)
  buildTrack({
    ticker: "AMD", direction: "CALL", startPrice: 100,
    daysAgo: 5, trajectory: -12, totalDays: 5,
    targetPct: 30, stopPct: 30, expiryDays: 10,
    score: 7.0,
  }),

  // ── SCENARIO 7: META PUT — TIME_EXPIRED at 10 days → WIN
  buildTrack({
    ticker: "META", direction: "PUT", startPrice: 300,
    daysAgo: 12, trajectory: -15, totalDays: 12,
    targetPct: 30, stopPct: 30, expiryDays: 10,
    score: 8.0,
  }),

  // ── SCENARIO 8: NFLX PUT — TIME_EXPIRED at 10 days → LOSS
  buildTrack({
    ticker: "NFLX", direction: "PUT", startPrice: 450,
    daysAgo: 12, trajectory: 8, totalDays: 12,
    targetPct: 30, stopPct: 30, expiryDays: 10,
    score: 7.5,
  }),

  // ── SCENARIO 9: MSFT CALL — Just started (1 day in, OPEN)
  buildTrack({
    ticker: "MSFT", direction: "CALL", startPrice: 380,
    daysAgo: 1, trajectory: 5, totalDays: 1,
    targetPct: 30, stopPct: 30, expiryDays: 10,
    score: 8.8,
  }),

  // ── SCENARIO 10: AMZN CALL — EDGE CASE: both target AND stop hit same day
  // Trajectory spikes up then crashes — simulated by high volatility
  (() => {
    const t = buildTrack({
      ticker: "AMZN", direction: "CALL", startPrice: 120,
      daysAgo: 14, trajectory: 2, totalDays: 14,
      targetPct: 10, stopPct: 10, expiryDays: 10, // tight thresholds
      volatility: 25, // very volatile → likely hits both same day
      score: 7.2,
      isEarningsPlay: true,
    });
    return t;
  })(),
];

// ─────────────────────────────────────────────────────────────────────────────
// Compute Stats
// ─────────────────────────────────────────────────────────────────────────────

const completed = mockTracks.filter(t => t.status !== "OPEN");
const wins = completed.filter(t => t.status === "WIN").length;
const losses = completed.filter(t => t.status === "LOSS").length;
const winRate = completed.length > 0
  ? ((wins / completed.length) * 100).toFixed(2) + "%"
  : "0.00%";

const targetWins  = completed.filter(t => t.status === "WIN"  && t.exitReason === "TARGET_PROFIT").length;
const stopLosses  = completed.filter(t => t.status === "LOSS" && t.exitReason === "STOP_LOSS").length;
const expiredWins = completed.filter(t => t.status === "WIN"  && t.exitReason === "TIME_EXPIRED").length;
const expiredLoss = completed.filter(t => t.status === "LOSS" && t.exitReason === "TIME_EXPIRED").length;

const payload = {
  updatedAt: new Date().toISOString(),
  maxTrackDays: MAX_TRACK_DAYS,
  defaultVerifyDays: DEFAULT_EXPIRY_DAYS,
  defaultTargetPct: DEFAULT_TARGET_PCT,
  defaultStopLossPct: DEFAULT_STOP_LOSS_PCT,
  stats: {
    total: mockTracks.length,
    completed: completed.length,
    open: mockTracks.filter(t => t.status === "OPEN").length,
    wins,
    losses,
    winRate,
    targetWins,
    stopLosses,
    expiredWins,
    expiredLoss,
  },
  tracks: mockTracks,
};

fs.writeFileSync(docsDataPath, JSON.stringify(payload, null, 2), "utf8");

console.log(`✅ Mock UI data generated at ${docsDataPath}`);
console.log(`\n📊 Mock Scenarios Summary:`);
console.log(`   Total tracks:   ${mockTracks.length}`);
console.log(`   Open:           ${payload.stats.open}`);
console.log(`   Completed:      ${payload.stats.completed}`);
console.log(`   Wins:           ${wins} | Losses: ${losses} | Win Rate: ${winRate}`);
console.log(`\n   Concurrent same-ticker: AAPL CALL + AAPL PUT (Scenarios 1+2)`);
console.log(`   Sequential same-ticker: TSLA CALL x2 (Scenarios 3+4)`);
console.log(`   Edge case (tight thresholds): AMZN CALL (Scenario 10)`);
console.log(`\n   All tracks have up to ${MAX_TRACK_DAYS} days of raw price data.`);

if (isLocalTest) {
  console.log(`\n   (Saved to local/ for local testing. Open docs/index.html via a local server.)`);
} else {
  console.log(`\n   (Saved to docs/ for GitHub Pages.)`);
}
