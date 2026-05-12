/**
 * TastyTrade option chain intelligence.
 *
 * For top-scoring candidates, fetches the option chain to extract:
 *   - Put/Call Ratio (PCR) from open interest → directional flow signal
 *   - Near-ATM option volume → confirms expected move size
 *
 * Strategy:
 *   1. GET /option-chains/{symbol}/nested → find nearest expiry ≤ 14 DTE
 *   2. Extract the 5 nearest ATM strike symbols (call + put)
 *   3. GET /market-data/by-type → get OI + volume for those contracts
 *   4. Calculate PCR = total put OI / total call OI
 *
 * Only runs for top 25 candidates (API rate limit consideration).
 * 500ms delay between each symbol's chain fetch.
 */

import { tastyFetch } from "./auth.js";

const CHAIN_DELAY     = 500;  // ms between option chain requests
const MAX_DTE         = 14;   // max days to expiration (short-term, big move focus)
const STRIKES_EACH    = 5;    // number of near-ATM strikes to evaluate (each side)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Calculate days to expiration from an expiration-date string.
 * @param {string} dateStr  — "YYYY-MM-DD"
 * @returns {number}
 */
function calcDTE(dateStr) {
  const exp = new Date(dateStr);
  exp.setHours(16, 0, 0, 0); // Market close ET
  const now = new Date();
  return Math.max(0, Math.ceil((exp - now) / 86_400_000));
}

/**
 * Fetch the nested option chain for a symbol and return PCR data.
 *
 * @param {string} symbol
 * @param {number} lastClose  — used to find near-ATM strikes
 * @returns {Promise<{ pcr: number|null, callOI: number, putOI: number, callVol: number, putVol: number } | null>}
 */
export async function fetchOptionChainPCR(symbol, lastClose) {
  try {
    // ── Step 1: Get nested option chain ──────────────────────────────────
    const chainRes = await tastyFetch(`/option-chains/${encodeURIComponent(symbol)}/nested`);
    if (!chainRes.ok) {
      console.warn(`  ⚠️  Chain fetch failed for ${symbol}: ${chainRes.status}`);
      return null;
    }

    const chainJson = await chainRes.json();
    const expirations = chainJson?.data?.items?.[0]?.expirations
      ?? chainJson?.data?.expirations
      ?? [];

    if (!expirations.length) {
      console.warn(`  ⚠️  No expirations found for ${symbol}`);
      return null;
    }

    // ── Step 2: Find nearest expiry ≤ MAX_DTE ─────────────────────────
    // Sort by DTE ascending and pick first one within range
    const withDTE = expirations
      .map(exp => ({
        ...exp,
        dte: calcDTE(exp["expiration-date"]),
      }))
      .filter(exp => exp.dte >= 1)
      .sort((a, b) => a.dte - b.dte);

    // Prefer ≤ MAX_DTE; fallback to nearest if none exist within range
    const nearestExpiry = withDTE.find(e => e.dte <= MAX_DTE) ?? withDTE[0];
    if (!nearestExpiry) return null;

    const dte     = nearestExpiry.dte;
    const strikes = nearestExpiry.strikes ?? [];
    if (!strikes.length) return null;

    // ── Step 3: Find near-ATM strikes ────────────────────────────────────
    // Sort strikes by proximity to last close, take nearest STRIKES_EACH each side
    const strikePrices = strikes.map(s => parseFloat(s["strike-price"])).filter(p => !isNaN(p));
    strikePrices.sort((a, b) => a - b);

    // Find ATM index
    const atmIdx = strikePrices.reduce((best, sp, i) => {
      return Math.abs(sp - lastClose) < Math.abs(strikePrices[best] - lastClose) ? i : best;
    }, 0);

    const start = Math.max(0, atmIdx - STRIKES_EACH);
    const end   = Math.min(strikePrices.length - 1, atmIdx + STRIKES_EACH);
    const nearATMPrices = new Set(strikePrices.slice(start, end + 1));

    // Collect call + put streamer symbols for those near-ATM strikes
    const callSymbols = [];
    const putSymbols  = [];

    for (const strike of strikes) {
      const price = parseFloat(strike["strike-price"]);
      if (!nearATMPrices.has(price)) continue;

      const callSym = strike["call-streamer-symbol"] ?? strike.call;
      const putSym  = strike["put-streamer-symbol"]  ?? strike.put;
      if (callSym) callSymbols.push(callSym);
      if (putSym)  putSymbols.push(putSym);
    }

    if (!callSymbols.length && !putSymbols.length) return null;

    // ── Step 4: Fetch market data for those contracts ──────────────────
    const allOptSymbols = [...callSymbols, ...putSymbols];
    const encoded = allOptSymbols.map(encodeURIComponent).join(",");
    const quoteRes = await tastyFetch(`/market-data/by-type?equity-option=${encoded}`);

    if (!quoteRes.ok) {
      console.warn(`  ⚠️  Quote fetch failed for ${symbol} options: ${quoteRes.status}`);
      return null;
    }

    const quoteJson = await quoteRes.json();
    const quotes    = quoteJson?.data?.items ?? quoteJson?.data ?? [];

    // ── Step 5: Calculate PCR ────────────────────────────────────────────
    let totalCallOI = 0, totalPutOI  = 0;
    let totalCallVol = 0, totalPutVol = 0;

    const callSet = new Set(callSymbols);
    const putSet  = new Set(putSymbols);

    for (const q of quotes) {
      const sym = q.symbol;
      const oi  = parseFloat(q["open-interest"] ?? q.openInterest ?? 0) || 0;
      const vol = parseFloat(q.volume ?? 0) || 0;

      if (callSet.has(sym)) {
        totalCallOI  += oi;
        totalCallVol += vol;
      } else if (putSet.has(sym)) {
        totalPutOI  += oi;
        totalPutVol += vol;
      }
    }

    const pcr = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(3) : null;

    return {
      pcr,
      callOI:  totalCallOI,
      putOI:   totalPutOI,
      callVol: totalCallVol,
      putVol:  totalPutVol,
      dte,
      expiryDate: nearestExpiry["expiration-date"],
    };
  } catch (err) {
    console.warn(`  ⚠️  Option chain error for ${symbol}: ${err.message}`);
    return null;
  }
}

/**
 * Enrich a list of top candidates with option chain PCR data.
 * Only processes up to `limit` symbols to keep API calls manageable.
 *
 * @param {Array<{ ticker: string, lastClose: number }>} candidates
 * @param {number} limit  — max symbols to enrich (default 25)
 * @returns {Promise<Map<string, object>>}  symbol → chain data
 */
export async function enrichWithOptionChain(candidates, limit = 25) {
  const top     = candidates.slice(0, limit);
  const chainMap = new Map();

  console.log(`\n  🔗  Fetching option chains for top ${top.length} candidates...`);

  for (let i = 0; i < top.length; i++) {
    const { ticker, lastClose } = top[i];
    const data = await fetchOptionChainPCR(ticker, lastClose);

    if (data) {
      chainMap.set(ticker, data);
      const pcrLabel = data.pcr !== null ? data.pcr.toFixed(2) : "n/a";
      console.log(
        `       ${ticker.padEnd(6)} | DTE ${data.dte} | PCR ${pcrLabel} ` +
        `| call OI ${data.callOI.toLocaleString()} | put OI ${data.putOI.toLocaleString()}`
      );
    }

    // Delay between requests (skip after last)
    if (i < top.length - 1) await sleep(CHAIN_DELAY);
  }

  console.log(`  ✅  Option chain data collected for ${chainMap.size} symbols`);
  return chainMap;
}
