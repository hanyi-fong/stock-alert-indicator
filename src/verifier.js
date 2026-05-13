/**
 * Fetch 5-minute intraday candles for the current day to get the true daily high/low/close.
 */
async function fetchIntraday(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; stock-scanner-verifier/2.0)",
      "Accept": "application/json",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${ticker}`);

  const q = result.indicators.quote[0];
  
  // Find the highest high and lowest low of the day, and the latest close
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let latestClose = null;

  for (let i = 0; i < q.high.length; i++) {
    if (q.high[i] != null && q.high[i] > maxHigh) maxHigh = q.high[i];
    if (q.low[i] != null && q.low[i] < minLow) minLow = q.low[i];
    if (q.close[i] != null) latestClose = q.close[i];
  }

  return {
    high: maxHigh !== -Infinity ? maxHigh : null,
    low: minLow !== Infinity ? minLow : null,
    close: latestClose,
  };
}

/**
 * Verify an array of past signals against current market prices.
 * @param {Array} previousSignals - from loadPreviousResult
 * @returns {Array} verification data
 */
export async function verifySignals(previousSignals) {
  const results = [];

  console.log(`\n🕵️‍♂️ Verifying ${previousSignals.length} morning signals...`);

  for (const sig of previousSignals) {
    try {
      const intraday = await fetchIntraday(sig.ticker);
      if (!intraday.close) {
        console.warn(`⚠️ Could not verify ${sig.ticker}: No intraday data`);
        continue;
      }

      // The price when the morning scan ran
      const entryPrice = sig.lastClose;
      const currentPrice = intraday.close;
      
      // Max Favorable Excursion (MFE): how far it went in our predicted direction
      let maxFavorablePrice = null;
      let maxFavorablePct = 0;
      let currentReturnPct = ((currentPrice - entryPrice) / entryPrice) * 100;

      if (sig.direction === "CALL") {
        maxFavorablePrice = intraday.high;
        maxFavorablePct = ((maxFavorablePrice - entryPrice) / entryPrice) * 100;
      } else {
        // PUT direction
        maxFavorablePrice = intraday.low;
        maxFavorablePct = ((entryPrice - maxFavorablePrice) / entryPrice) * 100; // Positive means it dropped (good for PUT)
        currentReturnPct = -currentReturnPct; // Invert so positive means profitable for PUT
      }

      results.push({
        ticker: sig.ticker,
        direction: sig.direction,
        score: sig.score,
        entryPrice,
        currentPrice,
        maxFavorablePrice,
        maxFavorablePct: +maxFavorablePct.toFixed(2),
        currentReturnPct: +currentReturnPct.toFixed(2),
        isProfitable: currentReturnPct > 0,
        intradayHigh: intraday.high,
        intradayLow: intraday.low,
      });

      console.log(`  ${sig.ticker.padEnd(6)} | Entry: $${entryPrice.toFixed(2)} | Current: $${currentPrice.toFixed(2)} | Max Excursion: ${maxFavorablePct > 0 ? '+' : ''}${maxFavorablePct.toFixed(2)}% | Return: ${currentReturnPct > 0 ? '+' : ''}${currentReturnPct.toFixed(2)}%`);
      
      // Delay to respect Yahoo rate limits
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.warn(`  ⚠️  Failed to verify ${sig.ticker}: ${err.message}`);
    }
  }

  return results;
}
