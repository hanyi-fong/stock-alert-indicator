import { CONFIG }                    from "./watchlist.js";
import { calcIndicators }            from "./indicators.js";
import { sendGoogleChatAlert, sendVerificationAlert } from "./notifier.js";
import { buildUniverse }             from "./tasty/watchlists.js";
import { fetchMarketMetrics }        from "./tasty/market-metrics.js";
import { enrichWithOptionChain }     from "./tasty/option-chain.js";
import { rankCandidates }            from "./scorer.js";
import { saveScanResult, loadPreviousResult, saveVerificationResult } from "./history.js";
import { verifySignals }             from "./verifier.js";

const DRY_RUN   = process.argv.includes("--dry-run");
const FULL_SCAN = process.argv.includes("--full-scan");

// Session parsing: e.g. --session morning, --session afternoon
let session = "manual";
const sessionIdx = process.argv.indexOf("--session");
if (sessionIdx > -1 && process.argv.length > sessionIdx + 1) {
  session = process.argv[sessionIdx + 1];
}
if (process.argv.includes("--record-manual")) session = "manual-record";

const IS_VERIFICATION_RUN = session === "afternoon" || process.argv.includes("--verify-manual");

const TOP_N     = 10;    // final signals to alert
const OPT_CHAIN_LIMIT = 25; // max candidates enriched with option chain

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
      "User-Agent": "Mozilla/5.0 (compatible; stock-scanner/2.0)",
      "Accept":     "application/json",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker}`);

  const json   = await res.json();
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

/**
 * Run technical analysis on a single ticker.
 * Returns the tech result, or null if insufficient data / fetch error.
 */
async function scanTicker(ticker) {
  try {
    const candles = await fetchCandles(ticker, CONFIG.historyDays);

    if (candles.length < CONFIG.macdSlow + CONFIG.macdSignal + 5) {
      console.log(`  ⚠️  ${ticker}: not enough data (${candles.length} candles)`);
      return null;
    }

    const tech = calcIndicators(candles, CONFIG);

    console.log(
      `  ${ticker.padEnd(6)} | $${tech.lastClose} | RSI ${tech.rsi ?? "--"} ` +
      `| MACD hist ${tech.macd?.hist ?? "--"} | vol ${tech.volumeRatio ?? "--"}x ` +
      `| 5d ${signed(tech.momentum5dPct)}% | ATR ${tech.atrPct ?? "--"}% ` +
      `| techScore ${tech.score}`
    );

    return tech;
  } catch (err) {
    console.warn(`  ⚠️  ${ticker}: ${err.message}`);
    return null;
  }
}

function signed(n) {
  if (n === null || n === undefined) return "--";
  return (n > 0 ? "+" : "") + n;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const runTime = new Date().toLocaleString("en-US", {
    timeZone:  "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });

  console.log(`\n🔍  Stock Scanner v2 (TastyTrade Enhanced) — ${runTime} ET`);
  if (DRY_RUN) console.log("    [DRY RUN MODE — webhook will not be called]");
  console.log(`    [SCAN MODE — ${FULL_SCAN ? "FULL SCAN" : "FAST SCAN (Potential Stocks Only)"}]\n`);

  // ── STEP 1: Build stock universe ────────────────────────────────────────
  console.log("\n📋  STEP 1: Building stock universe...");
  let universe;
  try {
    universe = await buildUniverse();
  } catch (err) {
    console.error(`  ❌  Failed to build TastyTrade universe: ${err.message}`);
    console.error("  ⚠️  Falling back to default watchlist from watchlist.js");
    const { WATCHLIST } = await import("./watchlist.js");
    universe = {
      symbols:      WATCHLIST,
      sources:      ["watchlist.js (fallback)"],
      getWatchlists: () => ["Default watchlist"],
    };
  }

  const { symbols: allSymbols, sources, getWatchlists } = universe;
  console.log(`  ✅  ${allSymbols.length} symbols from: ${sources.join(", ")}\n`);

  // ── STEP 2: Batch market metrics (TastyTrade) ────────────────────────────
  console.log("📊  STEP 2: Fetching TastyTrade market metrics...");
  let metricsMap = new Map();
  try {
    metricsMap = await fetchMarketMetrics(allSymbols);
  } catch (err) {
    console.error(`  ❌  Market metrics failed: ${err.message}`);
    console.warn("  ⚠️  Continuing without options metrics (technical-only mode)");
  }

  // Pre-filter (1st Level Scan)
  // FULL SCAN: remove F-rated symbols only if we have metrics for them
  // FAST SCAN: additionally remove low-potential stocks (e.g. low liquidity or low IVR)
  const universe_filtered = allSymbols.filter(sym => {
    const m = metricsMap.get(sym);
    if (!m) return true; // no metrics → keep it
    
    if (FULL_SCAN) {
      return m.liquidityScore > 1; // exclude F-rated
    } else {
      // FAST SCAN: Exclude if Liquidity is poor OR IVR is too low.
      // (Excluding "No Earnings" check per user feedback)
      const hasGoodLiquidity = m.liquidityScore > 2; // exclude F and D
      const hasGoodIVR = m.ivr !== null && m.ivr >= 30;
      return hasGoodLiquidity && hasGoodIVR;
    }
  });
  
  const removedCount = allSymbols.length - universe_filtered.length;
  if (removedCount > 0) {
    const reason = FULL_SCAN ? "F liquidity rating" : "low potential (poor liquidity or low IVR)";
    console.log(`  🗑️  Filtered out ${removedCount} symbols with ${reason}`);
  }

  // ── STEP 3: Technical scan (Yahoo Finance) ───────────────────────────────
  console.log(`\n📈  STEP 3: Technical scan (${universe_filtered.length} symbols)...\n`);

  const techResults = new Map(); // symbol → tech object

  for (const ticker of universe_filtered) {
    const tech = await scanTicker(ticker);
    if (tech) techResults.set(ticker, tech);
    await sleep(300); // 300ms between Yahoo Finance requests
  }

  console.log(`\n  ✅  Technical scan complete: ${techResults.size} symbols with data`);

  // Sort by |techScore| descending to focus option-chain fetch on best candidates
  const sortedByTechScore = [...techResults.entries()]
    .sort(([, a], [, b]) => Math.abs(b.score) - Math.abs(a.score));

  // ── STEP 4: Composite score (pre-chain) ──────────────────────────────────
  // Build candidates with tech + metrics for initial ranking
  const preCandidates = sortedByTechScore.map(([ticker, tech]) => ({
    ticker,
    tech,
    metrics:    metricsMap.get(ticker) ?? null,
    chain:      null,
    watchlists: getWatchlists ? getWatchlists(ticker) : [],
  }));

  // Pre-rank to find top candidates for option chain enrichment
  // Use tech score + IVR boost as a lightweight pre-score
  const preRanked = preCandidates.sort((a, b) => {
    const scoreA = Math.abs(a.tech.score) + (a.metrics?.ivr ?? 0) / 50;
    const scoreB = Math.abs(b.tech.score) + (b.metrics?.ivr ?? 0) / 50;
    return scoreB - scoreA;
  });

  // ── STEP 5: Option chain enrichment (top candidates only) ────────────────
  console.log(`\n🔗  STEP 4: Enriching top ${OPT_CHAIN_LIMIT} with option chain data...`);
  let chainMap = new Map();
  try {
    const topForChain = preRanked.slice(0, OPT_CHAIN_LIMIT).map(c => ({
      ticker:    c.ticker,
      lastClose: c.tech.lastClose,
    }));
    chainMap = await enrichWithOptionChain(topForChain, OPT_CHAIN_LIMIT);
  } catch (err) {
    console.error(`  ❌  Option chain enrichment failed: ${err.message}`);
    console.warn("  ⚠️  Continuing without PCR data");
  }

  // ── STEP 6: Final composite scoring ─────────────────────────────────────
  console.log("\n🏆  STEP 5: Computing composite scores...");

  const finalCandidates = preCandidates.map(c => ({
    ...c,
    chain: chainMap.get(c.ticker) ?? null,
  }));

  const topSignals = rankCandidates(finalCandidates, TOP_N);

  // ── STEP 7: Print results ────────────────────────────────────────────────
  console.log(`\n📊  Results: ${topSignals.length} signal(s) found\n`);

  if (topSignals.length > 0) {
    console.log("Signals (ranked by composite score):");
    for (const s of topSignals) {
      const earningsBadge = s.isEarningsPlay ? " 🚨 EARNINGS" : "";
      const ivrLabel      = s.ivr !== null ? ` IVR ${s.ivr.toFixed(0)}` : "";
      console.log(
        `  ${s.direction === "CALL" ? "🟢" : "🔴"} ${s.ticker.padEnd(6)}` +
        ` → ${s.direction} | score ${s.score}${ivrLabel}${earningsBadge}` +
        ` | ${s.reasons.slice(0, 3).join(", ")}`
      );
    }
  } else {
    console.log("  No strong signals found today.");
  }

  // ── STEP 8: Send alert and save history ──────────────────────────────────
  if (DRY_RUN) {
    console.log("\n[DRY RUN] — webhook not called, history not saved");
    return;
  }

  await sendGoogleChatAlert(topSignals, runTime);
  saveScanResult(topSignals, session);

  // ── STEP 9: Intraday Verification (Afternoon only) ───────────────────────
  if (IS_VERIFICATION_RUN) {
    console.log("\n============================================================");
    console.log("🔍  STEP 9: Running verification on previous scan...");
    
    const prevSession = session === "afternoon" ? "morning" : "manual-record";
    const prevSignals = loadPreviousResult(prevSession);
    
    if (prevSignals && prevSignals.length > 0) {
      const verificationData = await verifySignals(prevSignals);
      saveVerificationResult(verificationData, session);
      await sendVerificationAlert(verificationData, runTime);
    } else {
      console.log(`  ℹ️  No signals from ${prevSession} to verify.`);
    }
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
