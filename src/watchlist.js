// ─────────────────────────────────────────────
//  EDIT THIS LIST — tickers you want to watch
// ─────────────────────────────────────────────
export const WATCHLIST = [
  // High-beta / momentum names good for 0DTE
  "NVDA", "TSLA", "AMD", "META", "GOOGL",
  "AMZN", "MSFT", "AAPL", "NFLX", "COIN",
  "MSTR", "PLTR", "SOFI", "RIVN", "LCID",
  "SPY",  "QQQ",  "IWM",               // ETFs
];

// Thresholds — tweak to taste
export const CONFIG = {
  // RSI
  rsiOverbought: 70,        // potential PUT signal
  rsiOversold:   30,        // potential CALL signal

  // Volume spike: today's vol vs 20-day avg
  volumeSpikeMultiplier: 2.0,

  // Price move today (%) that qualifies as "big move"
  bigMovePercent: 3.0,

  // Bollinger Band period & stddev
  bbPeriod: 20,
  bbStdDev: 2,

  // MACD default settings
  macdFast:   12,
  macdSlow:   26,
  macdSignal: 9,

  // How many days of history to fetch
  historyDays: 60,
};
