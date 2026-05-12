/**
 * TastyTrade public watchlists — stock universe builder.
 *
 * Fetches selected public watchlists from TastyTrade and returns a
 * deduplicated list of equity symbols for scanning.
 *
 * Universe priority:
 *   1. WATCHLIST env var         → use exact tickers (highest priority)
 *   2. TASTYTRADE_WATCHLISTS env → fetch only those named watchlists
 *                                  (use "ALL" to fetch all 62 watchlists)
 *   3. Default (hardcoded)       → curated set of best watchlists for
 *                                  discovering massive-move stocks (~300-500 symbols)
 *
 * Why NOT fetch all 62 watchlists by default:
 *   The full universe has 2,400+ symbols. Each Yahoo Finance candle fetch
 *   takes ~300ms → ~12 minutes of scanning + likely rate-limited.
 *   The curated default targets optionable, liquid, high-activity names only.
 */

import { tastyFetch } from "./auth.js";

/**
 * Curated default watchlists for high-score stock discovery.
 * Based on actual TastyTrade public watchlist names discovered live.
 *
 * Chosen because they contain:
 * - Stocks with elevated IV (market already expects big moves)
 * - Recent momentum / fast movers (already in play)
 * - Upcoming earnings catalysts (guaranteed volatility event)
 * - Highly liquid, optionable names (can actually trade the signal)
 * - High-beta large-caps (bigger amplified moves)
 * - Breakout / breakdown candidates (52-week extremes)
 */
const DEFAULT_WATCHLISTS = [
  "tasty IVR",           // Elevated IVR stocks — market pricing in a move
  "tasty Fast Movers",   // Recent high-momentum names — already moving
  "All Earnings",        // Stocks with upcoming earnings — guaranteed catalyst
  "tasty Earnings",      // TastyTrade's curated earnings picks
  "High Options Volume", // Heavily traded options → liquid, active
  "Liquid Symbols",      // TastyTrade's most liquid optionable names
  "NASDAQ 100",          // Top 100 tech + growth (high beta)
  "S&P 100",             // Large-cap leaders with great options liquidity
  "52 Week Near High",   // Breakout candidates
  "52 Week Near Low",    // Oversold bounce / reversal candidates
];

/**
 * Fetch a single public watchlist by name.
 * Returns an array of equity symbols from that watchlist.
 */
async function fetchWatchlistByName(name) {
  try {
    const res = await tastyFetch(`/public-watchlists/${encodeURIComponent(name)}`);
    if (!res.ok) {
      console.warn(`  ⚠️  Could not fetch watchlist "${name}": ${res.status}`);
      return [];
    }
    const json = await res.json();
    const entries = json?.data?.["watchlist-entries"] ?? json?.["watchlist-entries"] ?? [];
    return entries
      .filter(e => e["instrument-type"] === "Equity")
      .map(e => e.symbol)
      .filter(Boolean);
  } catch (err) {
    console.warn(`  ⚠️  Error fetching watchlist "${name}": ${err.message}`);
    return [];
  }
}

/**
 * Fetch all available public watchlist names from TastyTrade.
 * (Used when TASTYTRADE_WATCHLISTS=ALL is set)
 */
async function fetchAllWatchlistNames() {
  const res = await tastyFetch("/public-watchlists");
  if (!res.ok) {
    throw new Error(`Failed to fetch public watchlists: ${res.status}`);
  }
  const json = await res.json();
  const items = json?.data?.items ?? json?.data ?? [];
  return items.map(w => w.name ?? w["watchlist-name"]).filter(Boolean);
}

/**
 * Build the full stock universe for scanning.
 *
 * @returns {{ symbols: string[], sources: string[], getWatchlists: Function }}
 */
export async function buildUniverse() {
  // ── Priority 1: WATCHLIST env var (exact tickers) ─────────────────────
  if (process.env.WATCHLIST) {
    const symbols = process.env.WATCHLIST
      .split(",")
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    console.log(`  📋  Using WATCHLIST env override: ${symbols.length} symbols`);
    return {
      symbols,
      sources:       ["WATCHLIST env var"],
      getWatchlists: () => ["WATCHLIST override"],
    };
  }

  // ── Priority 2: TASTYTRADE_WATCHLISTS env var ──────────────────────────
  let targetNames;

  if (process.env.TASTYTRADE_WATCHLISTS) {
    if (process.env.TASTYTRADE_WATCHLISTS.trim().toUpperCase() === "ALL") {
      console.log("  📋  TASTYTRADE_WATCHLISTS=ALL — fetching all public watchlists...");
      targetNames = await fetchAllWatchlistNames();
    } else {
      targetNames = process.env.TASTYTRADE_WATCHLISTS
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
    }
    console.log(`  📋  Using ${targetNames.length} watchlist(s) from env: ${targetNames.join(", ")}`);
  } else {
    // ── Priority 3: Curated default ─────────────────────────────────────
    targetNames = DEFAULT_WATCHLISTS;
    console.log(`  📋  Using curated default (${targetNames.length} watchlists):`);
    console.log(`       ${targetNames.join(", ")}`);
    console.log(`       (Tip: set TASTYTRADE_WATCHLISTS=ALL to scan the full universe)`);
  }

  // Fetch all watchlists concurrently
  const results = await Promise.all(
    targetNames.map(async name => {
      const syms = await fetchWatchlistByName(name);
      console.log(`       • "${name}": ${syms.length} equity symbols`);
      return { name, syms };
    })
  );

  // Deduplicate; track which lists contributed each symbol
  const symbolMap = new Map(); // symbol → Set<watchlistName>
  for (const { name, syms } of results) {
    for (const sym of syms) {
      if (!symbolMap.has(sym)) symbolMap.set(sym, new Set());
      symbolMap.get(sym).add(name);
    }
  }

  const symbols = [...symbolMap.keys()];
  console.log(`  ✅  Universe built: ${symbols.length} unique equity symbols`);

  return {
    symbols,
    sources:       targetNames,
    getWatchlists: (sym) => [...(symbolMap.get(sym) ?? [])],
  };
}
