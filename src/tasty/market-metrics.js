/**
 * TastyTrade market metrics enrichment.
 *
 * Fetches IVR, implied volatility index, beta, liquidity rating,
 * and earnings-next-date for a batch of symbols.
 *
 * API: GET /market-metrics?symbols=NVDA,TSLA,...
 * Batches symbols in chunks of 50 with 500ms delay between chunks.
 */

import { tastyFetch } from "./auth.js";

const BATCH_SIZE  = 50;   // API symbols per call
const BATCH_DELAY = 500;  // ms between batch requests

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Parse earnings-next-date and return days until earnings (null if none/past).
 * @param {string|null} dateStr  — ISO date string e.g. "2024-11-21"
 * @returns {number|null}
 */
function daysUntilEarnings(dateStr) {
  if (!dateStr) return null;
  const earning = new Date(dateStr);
  const now     = new Date();
  // Normalize to date only (ignore time)
  earning.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((earning - now) / 86_400_000);
  return diff >= 0 ? diff : null; // null if earnings already passed
}

/**
 * Parse TastyTrade liquidity rating string (e.g. "A", "B", "C", "D", "F")
 * into a numeric score for filtering.
 * Safely handles numeric ratings (some symbols return 0-5 int) or null.
 */
function liquidityScore(rating) {
  if (rating === null || rating === undefined) return 0;
  // Handle numeric ratings returned by the API (0-5 scale)
  if (typeof rating === "number") return Math.min(5, Math.max(0, Math.round(rating)));
  const scores = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  return scores[String(rating).toUpperCase()] ?? 0;
}

/**
 * Fetch market metrics for a single batch of symbols.
 * @param {string[]} symbols
 * @returns {Object[]} raw items from TastyTrade
 */
async function fetchMetricsBatch(symbols) {
  const query = symbols.map(encodeURIComponent).join(",");
  const res = await tastyFetch(`/market-metrics?symbols=${query}`);

  if (!res.ok) {
    const text = await res.text();
    console.warn(`  ⚠️  Market metrics batch failed (${res.status}): ${text.slice(0, 200)}`);
    return [];
  }

  const json = await res.json();
  return json?.data?.items ?? json?.data ?? [];
}

/**
 * Fetch market metrics for all symbols and return a Map<symbol, metrics>.
 *
 * @param {string[]} symbols
 * @returns {Promise<Map<string, {
 *   ivr: number|null,
 *   ivPercentile: number|null,
 *   ivIndex: number|null,
 *   beta: number|null,
 *   liquidityRating: string|null,
 *   liquidityScore: number,
 *   earningsNextDate: string|null,
 *   daysToEarnings: number|null,
 *   isEarningsPlay: boolean,
 * }>>}
 */
export async function fetchMarketMetrics(symbols) {
  const metricsMap = new Map();

  // Chunk into batches
  const batches = [];
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    batches.push(symbols.slice(i, i + BATCH_SIZE));
  }

  console.log(`  📊  Fetching market metrics (${symbols.length} symbols, ${batches.length} batch(es))...`);

  for (let i = 0; i < batches.length; i++) {
    const batch   = batches[i];
    const items   = await fetchMetricsBatch(batch);

    for (const item of items) {
      const symbol = item.symbol;
      if (!symbol) continue;

      const ivrRaw        = parseFloat(item["implied-volatility-index-rank"]);
      const ivr           = !isNaN(ivrRaw) ? ivrRaw * 100 : null;
      const ivpRaw        = parseFloat(item["implied-volatility-percentile"]);
      const ivPercentile  = !isNaN(ivpRaw) ? ivpRaw * 100 : null;
      const iviRaw        = parseFloat(item["implied-volatility-index"]);
      const ivIndex       = !isNaN(iviRaw) ? iviRaw * 100 : null;
      const beta          = parseFloat(item["beta"]) || null;
      const liqRating     = item["liquidity-rating"] ?? null;
      const earningsDate  = item["earnings-next-date"] ?? null;
      const daysToEarn    = daysUntilEarnings(earningsDate);

      metricsMap.set(symbol, {
        ivr,
        ivPercentile,
        ivIndex,
        beta,
        liquidityRating:  liqRating,
        liquidityScore:   liquidityScore(liqRating),
        earningsNextDate: earningsDate,
        daysToEarnings:   daysToEarn,
        isEarningsPlay:   daysToEarn !== null && daysToEarn <= 3,
      });
    }

    // Delay between batches (skip after last batch)
    if (i < batches.length - 1) {
      await sleep(BATCH_DELAY);
    }
  }

  console.log(`  ✅  Market metrics received for ${metricsMap.size} symbols`);
  return metricsMap;
}
