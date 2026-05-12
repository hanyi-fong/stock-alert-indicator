import { WATCHLIST, CONFIG } from "./watchlist.js";
import { calcIndicators } from "./indicators.js";
import { sendGoogleChatAlert } from "./notifier.js";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Fetch daily OHLCV candles directly from Yahoo Finance v8 API.
 * No API key needed. Works in GitHub Actions.
 */
async function fetchCandles(ticker, days) {
  const end   = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;
  const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}` +
                `?interval=1d&period1=${start}&period2=${end}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; stock-scanner/1.0)",
      "Accept":     "application/json",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${ticker}`);

  const timestamps = result.timestamp ?? [];
  const q          = result.indicators.quote[0];

  return timestamps
    .map((t, i) => ({
      date:   new Date(t * 1000),
      open:   q.open[i],
      high:   q.high[i],
      low:    q.low[i],
      close:  q.close[i],
      volume: q.volume[i] ?? 0,
    }))
    .filter(c => c.close != null);
}

async function scanTicker(ticker) {
  try {
    const candles = await fetchCandles(ticker, CONFIG.historyDays);

    if (candles.length < CONFIG.macdSlow + CONFIG.macdSignal + 5) {
      console.log(`  ⚠️  ${ticker}: not enough data (${candles.length} candles)`);
      return null;
    }

    const ind = calcIndicators(candles, CONFIG);

    console.log(
      `  ${ticker.padEnd(6)} | close $${ind.lastClose} | RSI ${ind.rsi ?? "--"} ` +
      `| MACD hist ${ind.macd?.hist ?? "--"} | vol ${ind.volumeRatio ?? "--"}x ` +
      `| day ${ind.dayChangePct > 0 ? "+" : ""}${ind.dayChangePct}% ` +
      `| score ${ind.score} ${ind.direction ? "→ " + ind.direction : ""}`
    );

    if (!ind.direction) return null;

    return { ticker, ...ind };

  } catch (err) {
    console.warn(`  ⚠️  ${ticker}: ${err.message}`);
    return null;
  }
}

async function fetchTrendingTickers() {
  try {
    const res = await fetch("https://query1.finance.yahoo.com/v1/finance/trending/US", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; stock-scanner/1.0)" }
    });
    if (!res.ok) return [];
    const json = await res.json();
    const quotes = json?.finance?.result?.[0]?.quotes ?? [];
    return quotes.map(q => q.symbol).filter(Boolean);
  } catch (err) {
    console.warn("  ⚠️  Failed to fetch trending tickers:", err.message);
    return [];
  }
}

async function main() {
  const runTime = new Date().toLocaleString("en-US", {
    timeZone:     "America/New_York",
    dateStyle:    "medium",
    timeStyle:    "short",
  });

  console.log(`\n🔍  Stock Scanner — ${runTime} ET`);
  console.log(`    Scanning ${WATCHLIST.length} watchlist tickers...\n`);

  // Scan watchlist tickers
  const watchlistSignals = [];
  for (const ticker of WATCHLIST) {
    const result = await scanTicker(ticker);
    if (result) watchlistSignals.push(result);
    await new Promise(r => setTimeout(r, 300)); // 300ms between requests
  }

  console.log(`\n🚀  Fetching trending tickers for auto-discovery...`);
  const trending = await fetchTrendingTickers();
  const newTrending = trending.filter(t => !WATCHLIST.includes(t));
  console.log(`    Found ${newTrending.length} new trending tickers.\n`);

  const trendingSignals = [];
  for (const ticker of newTrending) {
    const result = await scanTicker(ticker);
    if (result) trendingSignals.push(result);
    await new Promise(r => setTimeout(r, 300));
  }

  // Get up to top 10 highest-scoring trending signals
  trendingSignals.sort((a, b) => b.score - a.score);
  const topTrendingSignals = trendingSignals.slice(0, 10);

  const signals = [...watchlistSignals, ...topTrendingSignals];
  signals.sort((a, b) => b.score - a.score);

  console.log(`\n📊  Results: ${signals.length} signal(s) found`);

  if (signals.length > 0) {
    console.log("\nSignals:");
    for (const s of signals) {
      console.log(`  ${s.direction === "CALL" ? "🟢" : "🔴"} ${s.ticker} → ${s.direction} | score ${s.score} | ${s.reasons.join(", ")}`);
    }
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] — webhook not called");
    return;
  }

  await sendGoogleChatAlert(signals, runTime);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
