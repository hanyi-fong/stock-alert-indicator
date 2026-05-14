import fs from "fs";
import path from "path";

const isLocalTest = process.env.GITHUB_ACTIONS !== "true";
const HISTORY_DIR = path.join(process.cwd(), isLocalTest ? "local/history" : "history");
const MAX_TRACK_DAYS = 20; // Always collect up to 20 days of raw data
const DEFAULT_VERIFY_DAYS = parseInt(process.env.VERIFY_DAYS || "10", 10);
const DEFAULT_TARGET_PROFIT_PCT = parseFloat(process.env.TARGET_PROFIT_PCT || "30");
const DEFAULT_STOP_LOSS_PCT = parseFloat(process.env.STOP_LOSS_PCT || "30");

// Helper to sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Calculate verification status for a track.
 * 
 * KEY CHANGE: We NEVER stop collecting data early. We always walk all candles
 * up to MAX_TRACK_DAYS (20), recording every day's pctChange. We DO track
 * the first time target/stop/expiry is triggered (triggerDay), but data
 * collection continues so the UI can re-compute with different thresholds.
 *
 * @param {object} track
 * @param {number} startPrice
 * @param {Array}  trackingCandles - up to MAX_TRACK_DAYS candles
 * @param {number} defaultExpiryDays - the "expiry" window (not the data window)
 * @param {number} targetProfitPct
 * @param {number} stopLossPct
 * @returns {object}
 */
export function calculateVerificationStatus(
  track,
  startPrice,
  trackingCandles,
  defaultExpiryDays,
  targetProfitPct,
  stopLossPct
) {
  let status = "OPEN";
  let daysHeld = 0;
  let exitReason = null;
  let triggerDay = null; // index (0-based) when the trade first triggered
  const dailyChanges = [];
  let maxExcursionPct = 0;

  for (let idx = 0; idx < trackingCandles.length; idx++) {
    const c = trackingCandles[idx];
    daysHeld = idx + 1;

    let dayMaxPct, dayMinPct, pctChange;

    if (track.direction === "CALL") {
      dayMaxPct = ((c.high - startPrice) / startPrice) * 100;
      dayMinPct = ((c.low - startPrice) / startPrice) * 100;
      pctChange = ((c.close - startPrice) / startPrice) * 100;
    } else {
      // PUT
      dayMaxPct = ((startPrice - c.low) / startPrice) * 100;
      dayMinPct = ((startPrice - c.high) / startPrice) * 100;
      pctChange = ((startPrice - c.close) / startPrice) * 100;
    }

    if (dayMaxPct > maxExcursionPct) maxExcursionPct = dayMaxPct;

    dailyChanges.push({
      day: idx,
      date: c.date
        ? typeof c.date === "string"
          ? c.date.split("T")[0]
          : c.date.toISOString().split("T")[0]
        : `Day ${idx}`,
      close: c.close,
      pctChange: parseFloat(pctChange.toFixed(2)),
    });

    // Only compute trigger on the FIRST time we haven't triggered yet
    if (triggerDay === null) {
      const hitTarget = dayMaxPct >= targetProfitPct;
      const hitStop = dayMinPct <= -stopLossPct;

      if (hitTarget && hitStop) {
        // Both hit same day → treat as loss (stop likely hit first intraday)
        status = "LOSS";
        exitReason = "STOP_LOSS";
        triggerDay = idx;
      } else if (hitTarget) {
        status = "WIN";
        exitReason = "TARGET_PROFIT";
        triggerDay = idx;
      } else if (hitStop) {
        status = "LOSS";
        exitReason = "STOP_LOSS";
        triggerDay = idx;
      }

      // Check expiry (only if not yet triggered by price)
      if (triggerDay === null && daysHeld >= defaultExpiryDays) {
        const finalPct = pctChange;
        status = finalPct > 0 ? "WIN" : "LOSS";
        exitReason = "TIME_EXPIRED";
        triggerDay = idx;
      }
    }
    // After trigger: we keep looping to collect remaining price data
  }

  // If no trigger was ever hit and we didn't reach expiryDays, still OPEN
  // daysHeld here is total days of collected data (for open trades)
  const effectiveDaysHeld = triggerDay !== null ? triggerDay + 1 : daysHeld;

  return {
    dailyChanges,
    maxExcursionPct: parseFloat(maxExcursionPct.toFixed(2)),
    status,
    daysHeld: effectiveDaysHeld,
    exitReason,
    triggerDay, // null = still open
  };
}

/**
 * Fetch daily OHLCV candles directly from Yahoo Finance v8 API.
 */
async function fetchCandles(ticker, startTimestamp, endTimestamp) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${startTimestamp}&period2=${endTimestamp}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; stock-scanner/2.0)",
      "Accept": "application/json",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp ?? [];
  const q = result.indicators.quote[0];

  return timestamps
    .map((t, i) => ({
      date: new Date(t * 1000),
      open: q.open[i],
      high: q.high[i],
      low: q.low[i],
      close: q.close[i],
      volume: q.volume[i] ?? 0,
    }))
    .filter(c => c.close != null);
}

async function main() {
  console.log(`\n🔍 Running Verification (up to ${MAX_TRACK_DAYS} days data, default expiry ${DEFAULT_VERIFY_DAYS} days)...`);

  if (!fs.existsSync(HISTORY_DIR)) {
    console.log("No history directory found.");
    return;
  }

  const files = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.endsWith(".json") && !f.includes("verification") && !f.includes("index"));

  if (files.length === 0) {
    console.log("No history files to verify.");
    return;
  }

  // Load and parse all signals, sort chronologically
  const allEvents = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(HISTORY_DIR, file), "utf8");
      const data = JSON.parse(content);
      if (data.signals && Array.isArray(data.signals)) {
        allEvents.push({
          timestamp: new Date(data.timestamp),
          session: data.session,
          signals: data.signals,
        });
      }
    } catch (e) {
      console.warn(`Could not parse ${file}: ${e.message}`);
    }
  }

  allEvents.sort((a, b) => a.timestamp - b.timestamp);

  // Track lifecycle using unique trackId = ticker_direction_epoch
  // Allows multiple concurrent trades per ticker (even same direction if different sessions)
  const activeTracksById = new Map(); // trackId → track
  const activeKeyIndex = new Map();   // "ticker_direction" → Set of active trackIds
  const completedTracks = [];

  for (const event of allEvents) {
    const eventDate = event.timestamp;

    for (const signal of event.signals) {
      const { ticker, direction, score, isEarningsPlay, lastClose } = signal;
      const compositeKey = `${ticker}_${direction}`;

      // Check if there's already an open track for this ticker+direction from THIS SAME SESSION
      // (dedup: same scan session should not create duplicate tracks)
      const activeSiblings = activeKeyIndex.get(compositeKey) || new Set();
      let isDuplicateFromSameSession = false;
      for (const existingId of activeSiblings) {
        const existing = activeTracksById.get(existingId);
        if (existing) {
          const existingDate = new Date(existing.dateDetected);
          const diffHours = Math.abs(eventDate - existingDate) / 3600000;
          if (diffHours < 8) {
            // Same scan session (within 8 hours) → skip
            isDuplicateFromSameSession = true;
            break;
          }
        }
      }
      if (isDuplicateFromSameSession) continue;

      // Create a unique trackId for this new trade
      const trackId = `${ticker}_${direction}_${eventDate.getTime()}`;

      activeTracksById.set(trackId, {
        trackId,
        ticker,
        session: event.session,
        direction,
        score,
        isEarningsPlay,
        dateDetected: eventDate.toISOString(),
        startPrice: lastClose || null,
        dailyChanges: [],
        maxExcursionPct: 0,
        defaultTargetPct: DEFAULT_TARGET_PROFIT_PCT,
        defaultStopLossPct: DEFAULT_STOP_LOSS_PCT,
        defaultExpiryDays: DEFAULT_VERIFY_DAYS,
      });

      if (!activeKeyIndex.has(compositeKey)) activeKeyIndex.set(compositeKey, new Set());
      activeKeyIndex.get(compositeKey).add(trackId);
    }
  }

  // Combine active and completed for fetching
  const allTracksToVerify = [...completedTracks, ...activeTracksById.values()];

  console.log(`Found ${allTracksToVerify.length} unique tracks to verify.`);

  const verifiedTracks = [];

  // Current timestamp for fetching data up to today
  const endTimestamp = Math.floor(Date.now() / 1000);

  for (const track of allTracksToVerify) {
    console.log(`Fetching history for ${track.ticker} (${track.direction}) since ${track.dateDetected}...`);

    // Fetch from 1 day before detection to capture start price
    const startTimestamp = Math.floor(new Date(track.dateDetected).getTime() / 1000) - 86400;

    try {
      const candles = await fetchCandles(track.ticker, startTimestamp, endTimestamp);

      if (candles.length > 0) {
        const detectionTime = new Date(track.dateDetected).getTime();
        
        let startIndex;
        if (track.session === "afternoon") {
          // Afternoon scan: trade starts near market close. 
          // The first day of performance tracking is the NEXT trading day.
          startIndex = candles.findIndex(c => c.date.getTime() > detectionTime);
        } else {
          // Morning scan: trade starts near market open.
          // The first day of performance tracking is the CURRENT trading day.
          startIndex = candles.findIndex(c => c.date.getTime() + 86400 * 1000 > detectionTime);
        }

        if (startIndex === -1) {
          // No future candles available yet
          startIndex = candles.length;
        }

        const startPrice = track.startPrice || (startIndex < candles.length ? candles[startIndex].close : candles[candles.length - 1].close);
        track.startPrice = parseFloat(startPrice.toFixed(2));

        // Take up to MAX_TRACK_DAYS candles (20 days of data always)
        const trackingCandles = candles.slice(startIndex, startIndex + MAX_TRACK_DAYS);

        const result = calculateVerificationStatus(
          track,
          startPrice,
          trackingCandles,
          track.defaultExpiryDays,
          track.defaultTargetPct,
          track.defaultStopLossPct
        );

        track.dailyChanges = result.dailyChanges;
        track.maxExcursionPct = result.maxExcursionPct;
        track.status = result.status;
        track.daysHeld = result.daysHeld;
        track.exitReason = result.exitReason;
        track.triggerDay = result.triggerDay;
      }

      verifiedTracks.push(track);

      // Delay to avoid Yahoo Finance rate limits
      await sleep(300);

    } catch (err) {
      console.warn(`  ⚠️ Failed to fetch history for ${track.ticker}: ${err.message}`);
    }
  }

  // Sort by date detected (newest first)
  verifiedTracks.sort((a, b) => new Date(b.dateDetected) - new Date(a.dateDetected));

  const completed = verifiedTracks.filter(t => t.status !== "OPEN");
  const wins = completed.filter(t => t.status === "WIN").length;
  const losses = completed.filter(t => t.status === "LOSS").length;
  const winRate = completed.length > 0 ? ((wins / completed.length) * 100).toFixed(2) + "%" : "0.00%";

  const targetWins  = completed.filter(t => t.status === "WIN"  && t.exitReason === "TARGET_PROFIT").length;
  const stopLosses  = completed.filter(t => t.status === "LOSS" && t.exitReason === "STOP_LOSS").length;
  const expiredWins = completed.filter(t => t.status === "WIN"  && t.exitReason === "TIME_EXPIRED").length;
  const expiredLoss = completed.filter(t => t.status === "LOSS" && t.exitReason === "TIME_EXPIRED").length;

  console.log(`\n📊 Verification Stats:`);
  console.log(`  Total Tracks: ${verifiedTracks.length}`);
  console.log(`  Completed Trades: ${completed.length}`);
  console.log(`  Wins: ${wins}`);
  console.log(`  Losses: ${losses}`);
  console.log(`  Win Rate: ${winRate}`);

  const reportPath = path.join(HISTORY_DIR, "verification-report.json");
  const payload = {
    updatedAt: new Date().toISOString(),
    maxTrackDays: MAX_TRACK_DAYS,
    defaultVerifyDays: DEFAULT_VERIFY_DAYS,
    defaultTargetPct: DEFAULT_TARGET_PROFIT_PCT,
    defaultStopLossPct: DEFAULT_STOP_LOSS_PCT,
    stats: {
      total: verifiedTracks.length,
      completed: completed.length,
      open: verifiedTracks.length - completed.length,
      wins,
      losses,
      winRate,
      targetWins,
      stopLosses,
      expiredWins,
      expiredLoss,
    },
    tracks: verifiedTracks,
  };

  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n💾 Saved verification report to ${reportPath} with ${verifiedTracks.length} tracks.`);

  // Save a copy to docs/data.json for GitHub Pages (or local/ for local testing)
  const docsDir = path.join(process.cwd(), isLocalTest ? "local" : "docs");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  const docsDataPath = path.join(docsDir, "data.json");
  fs.writeFileSync(docsDataPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`💾 Saved copy for dashboard to ${docsDataPath}`);
}

if (process.argv[1] && process.argv[1].includes("verify-history.js")) {
  main().catch(err => {
    console.error("Fatal error during verification:", err);
    process.exit(1);
  });
}
