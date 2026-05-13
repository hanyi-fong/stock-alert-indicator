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
  const breakdown = { ...(tech.breakdown ?? {}) };

  // ─── Technical signals (already computed by indicators.js) ───────────────
  // We re-derive from the tech object rather than re-computing.
  // indicators.js returns a raw `score` — we use it as the starting base.
  score += tech.score;  // up to ±6 from MACD/RSI/BB/volume

  // ─── 5-day momentum (from indicators.js enhancements) ────────────────────
  // Note: momentum is trend-following (+1/-1), while RSI/BB are mean-reversion.
  // When they conflict (e.g. oversold RSI + negative momentum), they cancel
  // arithmetically — this is intentional and correct behaviour.
  let isOverextended = false;
  if (tech.momentum5dPct !== undefined && tech.momentum5dPct !== null) {
    if (tech.momentum5dPct >= 15) {
      score -= 2; // Penalise CALL score for exhaustion risk
      isOverextended = true;
      reasons.push(`⚠️ Overextended (+${tech.momentum5dPct.toFixed(1)}% in 5d) — exhaustion risk (-2)`);
      breakdown.momentum = "-2";
    } else if (tech.momentum5dPct <= -15) {
      score += 2; // Penalise PUT score for exhaustion risk
      isOverextended = true;
      reasons.push(`⚠️ Overextended (${tech.momentum5dPct.toFixed(1)}% in 5d) — exhaustion risk (+2)`);
      breakdown.momentum = "+2";
    } else if (tech.momentum5dPct >= 4) {
      score += 1;
      reasons.push(`5d momentum +${tech.momentum5dPct.toFixed(1)}% (+1)`);
      breakdown.momentum = "+1";
    } else if (tech.momentum5dPct <= -4) {
      score -= 1;
      reasons.push(`5d momentum ${tech.momentum5dPct.toFixed(1)}% (-1)`);
      breakdown.momentum = "-1";
    }
  }

  // ─── Signal Coherence Check ───────────────────────────────────────────────
  // Flags when trend-following momentum and mean-reversion RSI point in opposite
  // directions — a diagnostic warning, not a score change.
  // Example: stock up 10% in 5 days (trend = bullish) but RSI >= 70 (mean-rev = bearish)
  // In a strong trend this is normal; in a range it signals exhaustion.
  // We log it so the user knows the signal is mixed-conviction.
  if (tech.momentum5dPct !== undefined && tech.momentum5dPct !== null && tech.rsi !== null) {
    const momentumBullish = tech.momentum5dPct >= 4;
    const momentumBearish = tech.momentum5dPct <= -4;
    const rsiBearish      = tech.rsi >= 70;   // overbought → mean-rev PUT
    const rsiBullish      = tech.rsi <= 30;   // oversold   → mean-rev CALL

    if (momentumBullish && rsiBearish) {
      // Trend says UP, RSI says overbought/reversal risk
      reasons.push(`⚠️ Conflicting signals: momentum bullish (+${tech.momentum5dPct.toFixed(1)}%) but RSI overbought (${tech.rsi}) — mixed conviction`);
    } else if (momentumBearish && rsiBullish) {
      // Trend says DOWN, RSI says oversold/bounce risk
      reasons.push(`⚠️ Conflicting signals: momentum bearish (${tech.momentum5dPct.toFixed(1)}%) but RSI oversold (${tech.rsi}) — mixed conviction`);
    }
  }

  // ─── ATR% bonus (inherently volatile stock) ───────────────────────────────
  if (tech.atrPct !== undefined && tech.atrPct !== null && tech.atrPct >= 4) {
    // Add to magnitude in whichever direction we're already going
    const bonus = 0.5;
    const added = score >= 0 ? bonus : -bonus;
    score += added;
    reasons.push(`ATR ${tech.atrPct.toFixed(1)}% (high volatility) (${added > 0 ? '+' : ''}${added})`);
    breakdown.atr = `${added > 0 ? '+' : ''}${added}`;
  }

  // ─── Options market signals (from TastyTrade market-metrics) ─────────────
  if (metrics) {
    const { ivr, beta, liquidityScore: liqScore, isEarningsPlay, daysToEarnings } = metrics;

    // IVR bonus — market is pricing in a big move
    if (ivr !== null) {
      let ivrBonus = 0;
      let ivrStr = "";
      if (ivr >= 75)      { ivrBonus = 1.5; ivrStr = `IVR ${ivr.toFixed(0)} 🔥🔥 (very high)`; }
      else if (ivr >= 50) { ivrBonus = 1.0; ivrStr = `IVR ${ivr.toFixed(0)} 🔥 (high)`; }
      else if (ivr >= 30) { ivrBonus = 0.5; ivrStr = `IVR ${ivr.toFixed(0)} (elevated)`; }

      // IVR bonus amplifies the existing direction
      if (ivrBonus > 0) {
        if (isOverextended) {
          reasons.push(`${ivrStr} neutralized (stock overextended)`);
          breakdown.ivr = "neutralized";
        } else {
          const added = score >= 0 ? ivrBonus : -ivrBonus;
          score += added;
          reasons.push(`${ivrStr} (${added > 0 ? '+' : ''}${added})`);
          breakdown.ivr = `${added > 0 ? '+' : ''}${added}`;
        }
      }
    }

    // Beta bonus — high-beta stocks make bigger moves
    if (beta !== null && Math.abs(beta) >= 2.0) {
      const bonus = 1.0;
      const added = score >= 0 ? bonus : -bonus;
      score += added;
      reasons.push(`Beta ${beta.toFixed(1)} (high-amplitude) (${added > 0 ? '+' : ''}${added})`);
      breakdown.beta = `${added > 0 ? '+' : ''}${added}`;
    } else if (beta !== null && Math.abs(beta) >= 1.5) {
      const bonus = 0.5;
      const added = score >= 0 ? bonus : -bonus;
      score += added;
      reasons.push(`Beta ${beta.toFixed(1)} (${added > 0 ? '+' : ''}${added})`);
      breakdown.beta = `${added > 0 ? '+' : ''}${added}`;
    }

    // Liquidity filter — penalize illiquid options chains
    if (liqScore === 1) {
      // F rating — no tradeable options; heavily penalise
      const penalty = -(score * 0.5);
      score *= 0.5;
      reasons.push(`⚠️ Liquidity F (options illiquid) (${penalty > 0 ? '+' : ''}${penalty.toFixed(1)})`);
      breakdown.liquidity = `${penalty > 0 ? '+' : ''}${penalty.toFixed(1)}`;
    } else if (liqScore === 2) {
      // D rating — poor but tradeable; apply a moderate penalty so Full Scan
      // results are consistent with Fast Scan's pre-filter that excludes D-rated stocks.
      const penalty = -(score * 0.25);
      score *= 0.75;
      reasons.push(`⚠️ Liquidity D (poor options liquidity) (${penalty > 0 ? '+' : ''}${penalty.toFixed(1)})`);
      breakdown.liquidity = `${penalty > 0 ? '+' : ''}${penalty.toFixed(1)}`;
    }
  }

  // ─── Put/Call Ratio signal (from option chain) ────────────────────────────
  let pcrSignal = null;
  if (chain && chain.pcr !== null) {
    const pcr = chain.pcr;
    if (pcr < 0.65) {
      // Heavy call buying → bullish institutional flow
      score += 1;
      reasons.push(`PCR ${pcr.toFixed(2)} (call-heavy flow) (+1)`);
      breakdown.pcr = "+1";
      pcrSignal = "CALL-HEAVY";
    } else if (pcr > 1.5) {
      // Heavy put buying → bearish institutional flow
      score -= 1;
      reasons.push(`PCR ${pcr.toFixed(2)} (put-heavy flow) (-1)`);
      breakdown.pcr = "-1";
      pcrSignal = "PUT-HEAVY";
    } else {
      pcrSignal = "NEUTRAL";
    }
  }

  // ─── Earnings catalyst multiplier ────────────────────────────────────────
  let isEarningsPlay = false;
  if (metrics?.isEarningsPlay && Math.abs(score) >= EARNINGS_MIN_ABS) {
    const oldScore = score;
    const multiplier = 1.5;
    score = +(score * multiplier).toFixed(2);
    isEarningsPlay = true;
    const added = +(score - oldScore).toFixed(1);
    reasons.push(`🚨 EARNINGS in ${metrics.daysToEarnings} day(s) (${added > 0 ? '+' : ''}${added})`);
    breakdown.earnings = `${added > 0 ? '+' : ''}${added}`;
  }

  // ─── Explicit score cap ───────────────────────────────────────────────────
  // Raw math (especially with the 1.5× earnings multiplier) can produce values
  // beyond ±10. We clamp here so the documented scale is always honoured.
  score = Math.max(-10, Math.min(10, score));

  // Round score to 1 decimal
  score = +score.toFixed(1);

  // ─── Determine direction ──────────────────────────────────────────────────
  let direction = null;
  if (score >= CALL_THRESHOLD)       direction = "CALL";
  else if (score <= PUT_THRESHOLD)   direction = "PUT";
  else if (isEarningsPlay)           direction = score >= 0 ? "CALL" : "PUT"; // earnings override

  return {
    score,
    breakdown,
    direction,
    reasons,
    isEarningsPlay,
    pcrSignal,
    // Pass-through from tech
    rsi:              tech.rsi,
    macd:             tech.macd,
    dayChangePct:     tech.dayChangePct,
    volumeRatio:      tech.volumeRatio,
    volumeSpike:      tech.volumeSpike,
    lastClose:        tech.lastClose,
    momentum5dPct:    tech.momentum5dPct,
    atrPct:           tech.atrPct,
    // Trend-regime fields (ADX + RSI divergence)
    adx:              tech.adx             ?? null,
    adxRegime:        tech.adxRegime       ?? 'RANGING',
    rsiDivergence:    tech.rsiDivergence   ?? false,
    rsiDivergenceType: tech.rsiDivergenceType ?? null,
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

export function rankCandidates(candidates, topN = 10) {
  const envWatchlistRaw = process.env.WATCHLIST || "";
  const envWatchlist = envWatchlistRaw ? envWatchlistRaw.split(",").map(t => t.trim().toUpperCase()) : [];

  const scored = candidates
    .map(({ ticker, tech, metrics, chain, watchlists }) => {
      const res = compositeScore(tech, metrics, chain);
      if (res.direction === null && envWatchlist.includes(ticker)) {
        res.direction = "WATCH";
      }
      return {
        ticker,
        watchlists,
        ...res,
      };
    })
    .filter(s => s.direction !== null); // must have a clear CALL, PUT, or WATCH

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

  // Ensure env WATCHLIST items are always included, bypassing topN
  const topSignals = scored.slice(0, topN);
  const watchSignals = scored.filter(s => envWatchlist.includes(s.ticker) && !topSignals.includes(s));
  
  return [...topSignals, ...watchSignals];
}
