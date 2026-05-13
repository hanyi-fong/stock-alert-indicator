import fs from "fs";
import path from "path";

const isLocalTest = process.env.GITHUB_ACTIONS !== "true";
const HISTORY_DIR = path.join(process.cwd(), isLocalTest ? "local/history" : "history");
const VERIFY_DAYS = parseInt(process.env.VERIFY_DAYS || "10", 10);
const TARGET_PROFIT_PCT = parseFloat(process.env.TARGET_PROFIT_PCT || "30");
const STOP_LOSS_PCT = parseFloat(process.env.STOP_LOSS_PCT || "30");

// Helper to sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function calculateVerificationStatus(track, startPrice, trackingCandles, verifyDays, targetProfitPct, stopLossPct) {
  let status = "OPEN";
  let daysHeld = 0;
  let exitReason = null;
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
      date: c.date ? (typeof c.date === 'string' ? c.date.split('T')[0] : c.date.toISOString().split('T')[0]) : `Day ${idx}`,
      close: c.close,
      pctChange: parseFloat(pctChange.toFixed(2))
    });

    // Check if target or stop loss hit
    let hitTarget = dayMaxPct >= targetProfitPct;
    let hitStop = dayMinPct <= -stopLossPct;
    
    if (hitTarget && hitStop) {
      status = "LOSS";
      exitReason = "STOP_LOSS";
      break;
    } else if (hitTarget) {
      status = "WIN";
      exitReason = "TARGET_PROFIT";
      break;
    } else if (hitStop) {
      status = "LOSS";
      exitReason = "STOP_LOSS";
      break;
    }
  }
  
  if (status === "OPEN" && trackingCandles.length >= verifyDays) {
     const lastCandle = trackingCandles[trackingCandles.length - 1];
     let pctChange;
     if (track.direction === "CALL") {
       pctChange = ((lastCandle.close - startPrice) / startPrice) * 100;
     } else {
       pctChange = ((startPrice - lastCandle.close) / startPrice) * 100;
     }
     status = pctChange > 0 ? "WIN" : "LOSS";
     exitReason = "TIME_EXPIRED";
  }

  return {
    dailyChanges,
    maxExcursionPct: parseFloat(maxExcursionPct.toFixed(2)),
    status,
    daysHeld,
    exitReason
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
  console.log(`\n🔍 Running Verification for up to ${VERIFY_DAYS} days...`);
  
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
          signals: data.signals
        });
      }
    } catch (e) {
      console.warn(`Could not parse ${file}: ${e.message}`);
    }
  }
  
  allEvents.sort((a, b) => a.timestamp - b.timestamp);

  // Track the lifecycle of signals
  // ticker -> track object
  const activeTracks = new Map();
  const completedTracks = [];

  for (const event of allEvents) {
    const eventDate = event.timestamp;
    
    for (const signal of event.signals) {
      const { ticker, direction, score, isEarningsPlay } = signal;
      
      const existing = activeTracks.get(ticker);
      
      if (existing) {
        // If it's the same direction, ignore it
        if (existing.direction === direction) {
          continue;
        } else {
          // Direction changed, close the old track and start a new one
          completedTracks.push(existing);
          activeTracks.delete(ticker);
        }
      }

      // Start new track
      activeTracks.set(ticker, {
        ticker,
        direction,
        score,
        isEarningsPlay,
        dateDetected: eventDate.toISOString(),
        startPrice: null, // Will be filled from Yahoo Finance
        dailyChanges: [], // Array of daily price tracking
        maxExcursionPct: 0
      });
    }
  }

  // Combine active and completed for fetching
  const allTracksToVerify = [...completedTracks, ...activeTracks.values()];
  
  console.log(`Found ${allTracksToVerify.length} unique tracks to verify.`);

  const verifiedTracks = [];

  // Current timestamp for fetching data up to today
  const endTimestamp = Math.floor(Date.now() / 1000);

  for (const track of allTracksToVerify) {
    console.log(`Fetching history for ${track.ticker} (${track.direction}) since ${track.dateDetected}...`);
    
    // We want data from slightly before the detected date to ensure we get the start price
    const startTimestamp = Math.floor(new Date(track.dateDetected).getTime() / 1000) - 86400; // -1 day
    
    try {
      const candles = await fetchCandles(track.ticker, startTimestamp, endTimestamp);
      
      if (candles.length > 0) {
        // First candle after or on the detection date
        const detectionTime = new Date(track.dateDetected).getTime();
        let startIndex = candles.findIndex(c => c.date.getTime() >= detectionTime - 86400 * 1000); // Allow same day
        if (startIndex === -1) startIndex = 0;
        
        const startPrice = candles[startIndex].close;
        track.startPrice = startPrice;
        
        let maxExcursionPct = 0;

        // Take up to VERIFY_DAYS candles after start
        const trackingCandles = candles.slice(startIndex, startIndex + VERIFY_DAYS);
        
        const result = calculateVerificationStatus(track, startPrice, trackingCandles, VERIFY_DAYS, TARGET_PROFIT_PCT, STOP_LOSS_PCT);

        track.dailyChanges = result.dailyChanges;
        track.maxExcursionPct = result.maxExcursionPct;
        track.status = result.status;
        track.daysHeld = result.daysHeld;
        track.exitReason = result.exitReason;
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

  console.log(`\n📊 Verification Stats:`);
  console.log(`  Total Tracks: ${verifiedTracks.length}`);
  console.log(`  Completed Trades: ${completed.length}`);
  console.log(`  Wins: ${wins}`);
  console.log(`  Losses: ${losses}`);
  console.log(`  Win Rate: ${winRate}`);

  const reportPath = path.join(HISTORY_DIR, "verification-report.json");
  const payload = {
    updatedAt: new Date().toISOString(),
    verifyDays: VERIFY_DAYS,
    targetProfitPct: TARGET_PROFIT_PCT,
    stopLossPct: STOP_LOSS_PCT,
    stats: {
      total: verifiedTracks.length,
      completed: completed.length,
      open: verifiedTracks.length - completed.length,
      wins,
      losses,
      winRate
    },
    tracks: verifiedTracks
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

if (process.argv[1] && process.argv[1].includes('verify-history.js')) {
  main().catch(err => {
    console.error("Fatal error during verification:", err);
    process.exit(1);
  });
}
