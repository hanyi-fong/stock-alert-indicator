import { MACD, RSI, BollingerBands, ATR, ADX } from "technicalindicators";

/**
 * Calculate all indicators from an array of OHLCV candles.
 * @param {Array<{close, high, low, open, volume, date}>} candles  newest-last order
 * @param {Object} cfg   CONFIG from watchlist.js
 * @returns {Object}     flat object with latest indicator values + signals
 */
export function calcIndicators(candles, cfg) {
  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  // ── MACD ──────────────────────────────────────────────
  const macdResult = MACD.calculate({
    values:       closes,
    fastPeriod:   cfg.macdFast,
    slowPeriod:   cfg.macdSlow,
    signalPeriod: cfg.macdSignal,
    SimpleMAOscillator: false,
    SimpleMASignal:     false,
  });

  const macdLen  = macdResult.length;
  const macdPrev = macdResult[macdLen - 2] ?? null;
  const macdCurr = macdResult[macdLen - 1] ?? null;

  // Bullish crossover: MACD line crosses ABOVE signal → buy CALL
  const macdBullish =
    macdPrev && macdCurr &&
    macdPrev.MACD < macdPrev.signal &&
    macdCurr.MACD > macdCurr.signal;

  // Bearish crossover: MACD line crosses BELOW signal → buy PUT
  const macdBearish =
    macdPrev && macdCurr &&
    macdPrev.MACD > macdPrev.signal &&
    macdCurr.MACD < macdCurr.signal;

  // ── RSI ───────────────────────────────────────────────
  const rsiResult = RSI.calculate({ values: closes, period: 14 });
  const rsiCurr   = rsiResult[rsiResult.length - 1] ?? null;

  // ── Bollinger Bands ───────────────────────────────────
  const bbResult = BollingerBands.calculate({
    period: cfg.bbPeriod,
    values: closes,
    stdDev: cfg.bbStdDev,
  });
  const bbCurr    = bbResult[bbResult.length - 1] ?? null;
  const lastClose = closes[closes.length - 1];

  const bbBreakoutUp   = bbCurr && lastClose > bbCurr.upper;   // overextended → PUT
  const bbBreakoutDown = bbCurr && lastClose < bbCurr.lower;   // oversold → CALL

  // ── Volume spike ──────────────────────────────────────
  const recentVols   = volumes.slice(-21, -1);  // last 20 days avg
  const avgVolume    = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
  const todayVolume  = volumes[volumes.length - 1];
  const volumeSpike  = avgVolume > 0 && (todayVolume / avgVolume) >= cfg.volumeSpikeMultiplier;
  const volumeRatio  = avgVolume > 0 ? +(todayVolume / avgVolume).toFixed(2) : null;

  // ── Price move today ──────────────────────────────────
  const prevClose   = closes[closes.length - 2];
  const dayChangePct = prevClose > 0
    ? +(((lastClose - prevClose) / prevClose) * 100).toFixed(2)
    : 0;
  const bigMoveUp   = dayChangePct  >=  cfg.bigMovePercent;
  const bigMoveDown = dayChangePct  <= -cfg.bigMovePercent;

  // ── 5-Day Momentum (slope) ────────────────────────────
  let momentum5dPct = null;
  if (closes.length >= 5) {
    const close5dAgo = closes[closes.length - 5];
    momentum5dPct = close5dAgo > 0
      ? +((lastClose - close5dAgo) / close5dAgo * 100).toFixed(2)
      : null;
  }

  // ── ATR% (Average True Range as % of price) ───────────
  // High ATR% → inherently volatile → bigger expected moves
  let atrPct = null;
  if (candles.length >= 15 && highs.length >= 15 && lows.length >= 15) {
    try {
      const atrResult = ATR.calculate({
        period: 14,
        high:   highs,
        low:    lows,
        close:  closes,
      });
      const atrVal = atrResult[atrResult.length - 1];
      if (atrVal && lastClose > 0) {
        atrPct = +((atrVal / lastClose) * 100).toFixed(2);
      }
    } catch {
      // ATR calculation can fail with insufficient data — safe to ignore
    }
  }

  // ── ADX — Trend Regime Detection ──────────────────────
  // ADX measures trend STRENGTH (not direction).
  // < 20: Ranging/choppy → mean-reversion signals (RSI, BB) are reliable
  // 20-40: Moderate trend → RSI needs divergence confirmation for full credit
  // > 40: Strong trend  → RSI/BB are trend-following readings, not reversals — discount them
  let adx = null;
  let adxRegime = 'RANGING'; // Safe default — don't discount unless we have data
  try {
    const adxResult = ADX.calculate({
      period: 14,
      high:   highs,
      low:    lows,
      close:  closes,
    });
    if (adxResult && adxResult.length > 0) {
      adx = +adxResult[adxResult.length - 1].adx.toFixed(1);
      if      (adx >= 40) adxRegime = 'STRONG_TREND';
      else if (adx >= 20) adxRegime = 'TRENDING';
      else                adxRegime = 'RANGING';
    }
  } catch {
    // ADX calculation failed — fall back to RANGING (no discount applied)
  }

  // ── RSI Divergence Detection ──────────────────────────
  // Divergence = price and RSI moving in opposite directions near extremes.
  // This is a much more reliable reversal signal than raw RSI level alone.
  //
  // Method: compare the slope (direction) of price vs RSI over the last 5 bars.
  // A threshold of 3 RSI points filters out noise from genuine divergence.
  let rsiDivergence     = false;
  let rsiDivergenceType = null; // 'BULLISH' | 'BEARISH'

  if (rsiCurr !== null && rsiResult.length >= 5 && closes.length >= 5) {
    const recentCloses = closes.slice(-5);
    const recentRSI    = rsiResult.slice(-5);
    const priceSlope   = recentCloses[4] - recentCloses[0]; // + = price rising
    const rsiSlope     = recentRSI[4]   - recentRSI[0];    // + = RSI rising

    // Bearish divergence: price rising but RSI fading at overbought zone
    // → selling pressure building despite price highs → PUT signal credible
    if (priceSlope > 0 && rsiSlope < -3 && rsiCurr >= 60) {
      rsiDivergence     = true;
      rsiDivergenceType = 'BEARISH';
    }
    // Bullish divergence: price falling but RSI recovering at oversold zone
    // → buying pressure building despite price lows → CALL signal credible
    else if (priceSlope < 0 && rsiSlope > 3 && rsiCurr <= 40) {
      rsiDivergence     = true;
      rsiDivergenceType = 'BULLISH';
    }
  }

  // ── Composite signal scoring ──────────────────────────
  // Score > 0 = bullish (CALL candidate), < 0 = bearish (PUT candidate)
  let score = 0;
  const reasons = [];
  const breakdown = {};

  // ── MACD contribution ─────────────────────────────────
  const macdContrib = macdBullish ? 2 : macdBearish ? -2 : 0;
  if (macdBullish) { reasons.push("MACD bullish crossover (+2)"); breakdown.macd = "+2"; }
  if (macdBearish) { reasons.push("MACD bearish crossover (-2)"); breakdown.macd = "-2"; }

  // ── RSI contribution — with ADX Trend-Regime discounting ──────────────────
  // The core fix: in trending markets, overbought/oversold doesn't mean reversal.
  // We adjust RSI points based on how strong the current trend is (ADX).
  let rsiContrib = 0;

  if (rsiCurr !== null) {
    // Compute the raw (unadjusted) RSI points
    let rawRsiContrib = 0;
    let rsiLabel = '';
    if      (rsiCurr <= 25)                { rawRsiContrib =  3; rsiLabel = `RSI extreme oversold (${rsiCurr.toFixed(1)})`; }
    else if (rsiCurr <= cfg.rsiOversold)   { rawRsiContrib =  2; rsiLabel = `RSI oversold (${rsiCurr.toFixed(1)})`; }
    else if (rsiCurr >= 75)                { rawRsiContrib = -3; rsiLabel = `RSI extreme overbought (${rsiCurr.toFixed(1)})`; }
    else if (rsiCurr >= cfg.rsiOverbought) { rawRsiContrib = -2; rsiLabel = `RSI overbought (${rsiCurr.toFixed(1)})`; }

    if (rawRsiContrib !== 0) {
      // Check if divergence supports the RSI signal direction
      const divergenceAligns =
        rsiDivergence &&
        ((rsiDivergenceType === 'BULLISH' && rawRsiContrib > 0) ||
         (rsiDivergenceType === 'BEARISH' && rawRsiContrib < 0));

      if (adxRegime === 'STRONG_TREND') {
        // ADX > 40: Strong trend in play.
        // RSI overbought in a bull trend = "strong momentum", not "about to reverse".
        // Halve the contribution — still acknowledge the extreme, but not full weight.
        rsiContrib = rawRsiContrib > 0 ? 1 : -1;
        const sign = rsiContrib > 0 ? '+' : '';
        reasons.push(`${rsiLabel} (${sign}${rsiContrib}) ⚠️ discounted — strong trend (ADX: ${adx})`);
        breakdown.rsi = `${sign}${rsiContrib}`;

      } else if (adxRegime === 'TRENDING') {
        // ADX 20–40: Moderate trend. RSI alone is not reliable enough.
        // Require divergence confirmation to earn full points.
        if (divergenceAligns) {
          // Divergence confirmed → full credit + 0.5 conviction bonus
          const bonus    = rawRsiContrib > 0 ? 0.5 : -0.5;
          rsiContrib     = rawRsiContrib + bonus;
          const sign     = rsiContrib > 0 ? '+' : '';
          const divType  = rsiDivergenceType.toLowerCase();
          reasons.push(`${rsiLabel} + ${divType} divergence confirmed (${sign}${rsiContrib})`);
          breakdown.rsi = `${sign}${rsiContrib}`;
        } else {
          // No divergence → cap RSI at ±1 (treat raw level as noise in a trend)
          rsiContrib     = rawRsiContrib > 0 ? 1 : -1;
          const sign     = rsiContrib > 0 ? '+' : '';
          reasons.push(`${rsiLabel} (${sign}${rsiContrib}) — trending mkt, no divergence`);
          breakdown.rsi = `${sign}${rsiContrib}`;
        }

      } else {
        // ADX < 20: Ranging / choppy market.
        // Mean-reversion is highly reliable here — full credit, no discount.
        rsiContrib     = rawRsiContrib;
        const sign     = rsiContrib > 0 ? '+' : '';
        reasons.push(`${rsiLabel} (${sign}${rsiContrib})`);
        breakdown.rsi = `${sign}${rsiContrib}`;
      }
    }
  }

  // ── Diminishing returns: RSI + MACD correlation cap ───
  // A MACD crossover almost always coincides with RSI recovering from an extreme,
  // meaning both signals reflect the same underlying event. When they fire in the
  // same direction, cap their combined contribution to ±4 (instead of ±5) to
  // avoid overstating conviction on a single correlated move.
  // Note: rsiContrib here is already ADX-adjusted, so the cap operates on the
  // discounted value — this is intentional and correct.
  let combinedRsiMacd = macdContrib + rsiContrib;
  if (macdContrib !== 0 && rsiContrib !== 0 && Math.sign(macdContrib) === Math.sign(rsiContrib)) {
    const cap = Math.sign(combinedRsiMacd) * Math.min(4, Math.abs(combinedRsiMacd));
    if (Math.abs(combinedRsiMacd) > 4) {
      const diff = cap - combinedRsiMacd;
      reasons.push(`RSI+MACD correlation cap (${diff > 0 ? '+' : ''}${diff})`);
      breakdown.correlationCap = `${diff > 0 ? '+' : ''}${diff}`;
    }
    combinedRsiMacd = cap;
  }
  score += combinedRsiMacd;

  // ── Bollinger Bands — suppressed in strong trends ──────
  // In a strong trend, price breaking the upper/lower band is CONTINUATION,
  // not a reversal. Only apply BB signals in ranging or moderately trending markets.
  if (adxRegime !== 'STRONG_TREND') {
    if (bbBreakoutDown) { score += 1; reasons.push("BB lower band touch (+1)"); breakdown.bb = "+1"; }
    if (bbBreakoutUp)   { score -= 1; reasons.push("BB upper band breach (-1)"); breakdown.bb = "-1"; }
  } else if (bbBreakoutDown || bbBreakoutUp) {
    // Log for transparency but award 0 points
    const which = bbBreakoutDown ? 'lower' : 'upper';
    reasons.push(`BB ${which} band (0) — suppressed in strong trend (ADX: ${adx})`);
    breakdown.bb = "0";
  }

  if (volumeSpike && bigMoveUp)   { score += 1; reasons.push(`Volume spike ${volumeRatio}x + up ${dayChangePct}% (+1)`); breakdown.volume = "+1"; }
  if (volumeSpike && bigMoveDown) { score -= 1; reasons.push(`Volume spike ${volumeRatio}x + down ${dayChangePct}% (-1)`); breakdown.volume = "-1"; }

  const direction = score >= 2 ? "CALL" : score <= -2 ? "PUT" : null;

  return {
    score,
    breakdown,
    direction,        // "CALL", "PUT", or null — technical direction only
    reasons,
    macd: macdCurr ? { macd: +macdCurr.MACD.toFixed(4), signal: +macdCurr.signal.toFixed(4), hist: +macdCurr.histogram.toFixed(4) } : null,
    rsi: rsiCurr ? +rsiCurr.toFixed(1) : null,
    bb: bbCurr ? { upper: +bbCurr.upper.toFixed(2), middle: +bbCurr.middle.toFixed(2), lower: +bbCurr.lower.toFixed(2) } : null,
    dayChangePct,
    volumeRatio,
    volumeSpike,
    lastClose,
    momentum5dPct,
    atrPct,
    // New: trend-regime fields (consumed by scorer.js for coherence flag + pass-through)
    adx,
    adxRegime,
    rsiDivergence,
    rsiDivergenceType,
  };
}
