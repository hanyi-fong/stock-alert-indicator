import { MACD, RSI, BollingerBands, ATR } from "technicalindicators";

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

  // ── Composite signal scoring ──────────────────────────
  // Score > 0 = bullish (CALL candidate), < 0 = bearish (PUT candidate)
  let score = 0;
  const reasons = [];

  if (macdBullish)    { score += 2; reasons.push("MACD bullish crossover"); }
  if (macdBearish)    { score -= 2; reasons.push("MACD bearish crossover"); }

  // RSI with extreme levels getting extra weight
  if (rsiCurr !== null && rsiCurr <= 25)          { score += 3; reasons.push(`RSI extreme oversold (${rsiCurr.toFixed(1)})`); }
  else if (rsiCurr !== null && rsiCurr <= cfg.rsiOversold)  { score += 2; reasons.push(`RSI oversold (${rsiCurr.toFixed(1)})`); }
  if (rsiCurr !== null && rsiCurr >= 75)           { score -= 3; reasons.push(`RSI extreme overbought (${rsiCurr.toFixed(1)})`); }
  else if (rsiCurr !== null && rsiCurr >= cfg.rsiOverbought){ score -= 2; reasons.push(`RSI overbought (${rsiCurr.toFixed(1)})`); }

  if (bbBreakoutDown) { score += 1; reasons.push("BB lower band touch"); }
  if (bbBreakoutUp)   { score -= 1; reasons.push("BB upper band breach"); }
  if (volumeSpike && bigMoveUp)   { score += 1; reasons.push(`Volume spike ${volumeRatio}x + up ${dayChangePct}%`); }
  if (volumeSpike && bigMoveDown) { score -= 1; reasons.push(`Volume spike ${volumeRatio}x + down ${dayChangePct}%`); }

  const direction = score >= 2 ? "CALL" : score <= -2 ? "PUT" : null;

  return {
    score,
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
  };
}
