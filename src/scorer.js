/**
 * Composite scoring engine — the brain of the scanner.
 *
 * Fuses technical indicators with TastyTrade options-market intelligence
 * to rank stocks by their probability of a massive price move.
 *
 * Score scale: -10 to +10
 *   Positive (≥ +3) → CALL candidate
 *   Negative (≤ -3) → PUT candidate
 *   |score| in 2-3  → "WATCH" (borderline, omitted from alerts)
 *
 * Earnings override:
 *   If earnings within 3 days AND |score| ≥ 2 → multiply by 1.5x, always alert.
 */

// ─── Score thresholds ─────────────────────────────────────────────────────────
const CALL_THRESHOLD    = 3;   // minimum score to flag as CALL
const PUT_THRESHOLD     = -3;  // maximum score to flag as PUT
const EARNINGS_MIN_ABS  = 2;   // min |score| to include as earnings play

/**
 * Calculate the composite score for a single stock.
 *
 * @param {object} tech    — output of calcIndicators() from indicators.js
 * @param {object} metrics — market metrics for this symbol (from market-metrics.js)
 * @param {object|null} chain — option chain PCR data (may be null)
 * @returns {object}  enriched signal object
 */
export function compositeScore(tech, metrics, chain) {
  let score   = 0;
  const reasons = [...(tech.reasons ?? [])];

  // ─── Technical signals (already computed by indicators.js) ───────────────
  // We re-derive from the tech object rather than re-computing.
  // indicators.js returns a raw `score` — we use it as the starting base.
  score += tech.score;  // up to ±6 from MACD/RSI/BB/volume

  // ─── 5-day momentum (from indicators.js enhancements) ────────────────────
  if (tech.momentum5dPct !== undefined && tech.momentum5dPct !== null) {
    if (tech.momentum5dPct >= 4) {
      score += 1;
      reasons.push(`5d momentum +${tech.momentum5dPct.toFixed(1)}%`);
    } else if (tech.momentum5dPct <= -4) {
      score -= 1;
      reasons.push(`5d momentum ${tech.momentum5dPct.toFixed(1)}%`);
    }
  }

  // ─── ATR% bonus (inherently volatile stock) ───────────────────────────────
  if (tech.atrPct !== undefined && tech.atrPct !== null && tech.atrPct >= 4) {
    // Add to magnitude in whichever direction we're already going
    const bonus = 0.5;
    score += score >= 0 ? bonus : -bonus;
    reasons.push(`ATR ${tech.atrPct.toFixed(1)}% (high volatility)`);
  }

  // ─── Options market signals (from TastyTrade market-metrics) ─────────────
  if (metrics) {
    const { ivr, beta, liquidityScore: liqScore, isEarningsPlay, daysToEarnings } = metrics;

    // IVR bonus — market is pricing in a big move
    if (ivr !== null) {
      let ivrBonus = 0;
      if (ivr >= 75)      { ivrBonus = 1.5; reasons.push(`IVR ${ivr.toFixed(0)} 🔥🔥 (very high)`); }
      else if (ivr >= 50) { ivrBonus = 1.0; reasons.push(`IVR ${ivr.toFixed(0)} 🔥 (high)`); }
      else if (ivr >= 30) { ivrBonus = 0.5; reasons.push(`IVR ${ivr.toFixed(0)} (elevated)`); }

      // IVR bonus amplifies the existing direction
      if (ivrBonus > 0) {
        score += score >= 0 ? ivrBonus : -ivrBonus;
      }
    }

    // Beta bonus — high-beta stocks make bigger moves
    if (beta !== null && Math.abs(beta) >= 2.0) {
      const bonus = 1.0;
      score += score >= 0 ? bonus : -bonus;
      reasons.push(`Beta ${beta.toFixed(1)} (high-amplitude)`);
    } else if (beta !== null && Math.abs(beta) >= 1.5) {
      const bonus = 0.5;
      score += score >= 0 ? bonus : -bonus;
      reasons.push(`Beta ${beta.toFixed(1)}`);
    }

    // Liquidity filter — heavily penalize F-rated (un-tradeable options)
    if (liqScore === 1) {
      // F rating — no tradeable options, disqualify for options plays
      score *= 0.5;
      reasons.push("⚠️ Liquidity F (options illiquid)");
    }
  }

  // ─── Put/Call Ratio signal (from option chain) ────────────────────────────
  let pcrSignal = null;
  if (chain && chain.pcr !== null) {
    const pcr = chain.pcr;
    if (pcr < 0.65) {
      // Heavy call buying → bullish institutional flow
      score += 1;
      reasons.push(`PCR ${pcr.toFixed(2)} (call-heavy flow)`);
      pcrSignal = "CALL-HEAVY";
    } else if (pcr > 1.5) {
      // Heavy put buying → bearish institutional flow
      score -= 1;
      reasons.push(`PCR ${pcr.toFixed(2)} (put-heavy flow)`);
      pcrSignal = "PUT-HEAVY";
    } else {
      pcrSignal = "NEUTRAL";
    }
  }

  // ─── Earnings catalyst multiplier ────────────────────────────────────────
  let isEarningsPlay = false;
  if (metrics?.isEarningsPlay && Math.abs(score) >= EARNINGS_MIN_ABS) {
    const multiplier = 1.5;
    score = +(score * multiplier).toFixed(2);
    isEarningsPlay = true;
    reasons.push(`🚨 EARNINGS in ${metrics.daysToEarnings} day(s)`);
  }

  // Round score to 1 decimal
  score = +score.toFixed(1);

  // ─── Determine direction ──────────────────────────────────────────────────
  let direction = null;
  if (score >= CALL_THRESHOLD)       direction = "CALL";
  else if (score <= PUT_THRESHOLD)   direction = "PUT";
  else if (isEarningsPlay)           direction = score >= 0 ? "CALL" : "PUT"; // earnings override

  return {
    score,
    direction,
    reasons,
    isEarningsPlay,
    pcrSignal,
    // Pass-through from tech
    rsi:          tech.rsi,
    macd:         tech.macd,
    dayChangePct: tech.dayChangePct,
    volumeRatio:  tech.volumeRatio,
    volumeSpike:  tech.volumeSpike,
    lastClose:    tech.lastClose,
    momentum5dPct: tech.momentum5dPct,
    atrPct:       tech.atrPct,
    // Pass-through from metrics
    ivr:              metrics?.ivr    ?? null,
    ivIndex:          metrics?.ivIndex ?? null,
    beta:             metrics?.beta   ?? null,
    liquidityRating:  metrics?.liquidityRating ?? null,
    earningsNextDate: metrics?.earningsNextDate ?? null,
    daysToEarnings:   metrics?.daysToEarnings  ?? null,
    // Option chain
    pcr:        chain?.pcr        ?? null,
    chainDte:   chain?.dte        ?? null,
    expiryDate: chain?.expiryDate ?? null,
  };
}

/**
 * Rank all scanned symbols and return the top N by composite score.
 *
 * @param {Array<{ ticker: string, tech: object, metrics: object|null, chain: object|null }>} candidates
 * @param {number} topN  — max results to return (default 10)
 * @returns {Array<object>}  sorted by |compositeScore| descending
 */
export function rankCandidates(candidates, topN = 10) {
  const scored = candidates
    .map(({ ticker, tech, metrics, chain, watchlists }) => ({
      ticker,
      watchlists,
      ...compositeScore(tech, metrics, chain),
    }))
    .filter(s => s.direction !== null); // must have a clear CALL or PUT

  // Sort by absolute score descending (biggest magnitude = most extreme setup)
  // Tie-breakers: IVR descending, then Volume Ratio descending
  scored.sort((a, b) => {
    const scoreDiff = Math.abs(b.score) - Math.abs(a.score);
    if (scoreDiff !== 0) return scoreDiff; // Primary sort: Score

    const ivrDiff = (b.ivr || 0) - (a.ivr || 0);
    if (ivrDiff !== 0) return ivrDiff; // Secondary sort: IVR

    const volDiff = (b.volumeRatio || 0) - (a.volumeRatio || 0);
    return volDiff; // Tertiary sort: Volume Ratio
  });

  return scored.slice(0, topN);
}
