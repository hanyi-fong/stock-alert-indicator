import fs from "fs";
import path from "path";

const HISTORY_DIR = path.join(process.cwd(), "history");
const VERIFY_DAYS = parseInt(process.env.VERIFY_DAYS || "10", 10);

// Helper to sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
        
        track.dailyChanges = trackingCandles.map((c, idx) => {
          const change = c.close - startPrice;
          const pctChange = (change / startPrice) * 100;
          
          // Calculate excursion (max favorable movement)
          let currentExcursion = 0;
          if (track.direction === "CALL") {
            currentExcursion = ((c.high - startPrice) / startPrice) * 100;
            if (currentExcursion > maxExcursionPct) maxExcursionPct = currentExcursion;
          } else {
            currentExcursion = ((startPrice - c.low) / startPrice) * 100;
            if (currentExcursion > maxExcursionPct) maxExcursionPct = currentExcursion;
          }

          return {
            day: idx,
            date: c.date.toISOString().split('T')[0],
            close: c.close,
            pctChange: parseFloat(pctChange.toFixed(2))
          };
        });

        track.maxExcursionPct = parseFloat(maxExcursionPct.toFixed(2));
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

  const reportPath = path.join(HISTORY_DIR, "verification-report.json");
  const payload = {
    updatedAt: new Date().toISOString(),
    verifyDays: VERIFY_DAYS,
    tracks: verifiedTracks
  };

  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n💾 Saved verification report to ${reportPath} with ${verifiedTracks.length} tracks.`);

  // Save a copy to docs/data.json for GitHub Pages
  const docsDir = path.join(process.cwd(), "docs");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  const docsDataPath = path.join(docsDir, "data.json");
  fs.writeFileSync(docsDataPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`💾 Saved copy for dashboard to ${docsDataPath}`);
}

main().catch(err => {
  console.error("Fatal error during verification:", err);
  process.exit(1);
});
