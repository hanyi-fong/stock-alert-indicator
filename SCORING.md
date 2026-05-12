# Stock Scanner — Scoring System Explained

> **Goal:** Find stocks with the highest probability of a **massive price move** (up or down) — suitable for buying short-dated CALL or PUT options.

---

## Score Scale

```
-10 ────────── -3 ──── 0 ──── +3 ────────── +10
PUT signal     PUT   WATCH   CALL     CALL signal
(strong)      (min)          (min)    (strong)
```

| Score | Direction | Meaning |
|---|---|---|
| ≥ +3 | **CALL** 🟢 | Bullish — buy CALL |
| ≤ −3 | **PUT** 🔴 | Bearish — buy PUT |
| −2 to +2 | — | No clear signal (ignored) |
| Earnings override | CALL or PUT | Even score ≥ |2| is alerted if earnings within 3 days |

> **Score cap:** The composite score is **hard-clamped to ±10** after all stages. The 1.5× earnings multiplier can push raw values above 10 (e.g. 9.5 × 1.5 = 14.25), but the displayed score will never exceed ±10.

---

## Stage 1 — Technical Score (from `indicators.js`)

These signals are computed from 60 days of daily OHLCV candle data fetched from Yahoo Finance.

### 1.1 MACD Crossover `±2 pts`

The **MACD (Moving Average Convergence Divergence)** detects momentum shifts.

- Settings: Fast 12 / Slow 26 / Signal 9
- Compares the MACD line vs the Signal line on **two consecutive days** to detect a crossover

| Condition | Points |
|---|---|
| MACD line crosses **above** signal (prev below, curr above) | **+2** (CALL) |
| MACD line crosses **below** signal (prev above, curr below) | **−2** (PUT) |

> A MACD crossover means momentum just flipped — high-probability direction change.

---

### 1.2 RSI (Relative Strength Index) `up to ±3 pts`

The **RSI** measures how overbought or oversold a stock is on a 0–100 scale. Uses 14-day period with Wilder's smoothing.

| RSI Value | Condition | Points |
|---|---|---|
| ≤ 25 | Extreme oversold | **+3** (CALL) |
| ≤ 30 | Oversold | **+2** (CALL) |
| ≥ 75 | Extreme overbought | **−3** (PUT) |
| ≥ 70 | Overbought | **−2** (PUT) |

> Extreme RSI + MACD crossover together is the most reliable reversal signal.

#### RSI + MACD Correlation Cap

Because a MACD bullish crossover almost always occurs at the same time RSI is recovering from an oversold reading (and vice versa for bearish), both signals often reflect a **single underlying event** rather than two independent data points.

To prevent double-counting, when MACD and RSI both fire in the **same direction**, their combined contribution is **capped at ±4** (instead of the raw ±5):

| MACD | RSI | Raw | Capped |
|---|---|---|---|
| +2 | +2 | +4 | +4 (no cap needed) |
| +2 | +3 | +5 | **+4** |
| −2 | −3 | −5 | **−4** |
| +2 | −2 | 0 | 0 (opposite dirs — no cap) |

When the cap applies, a `RSI+MACD correlation cap` note is added to the signal reasons.

---

### 1.3 Bollinger Bands `±1 pt`

**Bollinger Bands** measure price relative to a 20-day moving average ± 2 standard deviations.

| Condition | Points |
|---|---|
| Close **below lower band** (oversold extreme) | **+1** (CALL) |
| Close **above upper band** (overbought extreme) | **−1** (PUT) |

---

### 1.4 Volume Spike + Price Move `±1 pt`

Confirms institutional activity — smart money is moving.

- Volume spike = today's volume ≥ **2×** the 20-day average
- Big move = today's price change ≥ **3%** in either direction

| Condition | Points |
|---|---|
| Volume spike + price up ≥ 3% | **+1** (CALL) |
| Volume spike + price down ≥ 3% | **−1** (PUT) |

---

### 1.5 5-Day Momentum `±1 pt`

**Trend strength** over the last 5 trading days (price % change from 5 days ago to today).

| Condition | Points |
|---|---|
| 5-day momentum ≥ +15% | **−2** (Exhaustion risk / overbought) |
| 5-day momentum ≤ −15% | **+2** (Exhaustion risk / oversold) |
| 5-day momentum +4% to +14.9% | **+1** (CALL — strong uptrend) |
| 5-day momentum -4% to -14.9% | **−1** (PUT — strong downtrend) |

> A stock running up > 15% in 5 days is highly susceptible to a "sell the news" pullback. The algorithm penalizes extreme momentum to prevent buying the absolute top (or shorting the absolute bottom).

---

## Stage 2 — Options Market Signals (from TastyTrade `/market-metrics`)

These signals come from TastyTrade's market intelligence — what professional options traders are pricing in.

### 2.1 IVR — Implied Volatility Rank `up to ±1.5 pts`

**IVR (0–100)** tells you how expensive options are compared to the past 52 weeks.
- **High IVR = options market expects a big move**
- IVR > 50 means IV is in the top 50th percentile of the past year

The IVR bonus **amplifies the existing direction** (adds to CALL score if positive, to PUT score if negative), **unless the stock is overextended**:

| IVR Level | Bonus | Label |
|---|---|---|
| ≥ 75 | **±1.5** | 🔥🔥 Very high — strong move priced in |
| 50–74 | **±1.0** | 🔥 High |
| 30–49 | **±0.5** | Elevated |
| < 30 | 0 | Normal |

> High IVR alone doesn't tell direction — it just confirms the market expects big movement. Combined with technical direction, it's a powerful amplifier.
>
> **Note:** If a stock is mathematically overextended (> ±15% 5-day momentum), the IVR bonus is **neutralized**. High IVR after a parabolic run often indicates the market is pricing in a crash or offering, not further continuation.

---

### 2.2 Beta `up to ±1 pt`

**Beta** measures how much a stock amplifies the market's moves (vs S&P 500).

The beta bonus amplifies the existing direction:

| Beta | Bonus | Meaning |
|---|---|---|
| ≥ 2.0 | **±1.0** | Moves 2× the market |
| 1.5–1.99 | **±0.5** | Moderately amplified |
| < 1.5 | 0 | Normal |

> High-beta stocks like NVDA (β ≈ 2.1) or TSLA (β ≈ 2.4) make much bigger moves when their direction is confirmed.

---

### 2.3 ATR% — Average True Range `±0.5 pts`

**ATR%** = 14-day Average True Range as a % of price. Measures a stock's inherent daily volatility.

| ATR% | Bonus |
|---|---|
| ≥ 4% | **±0.5** (direction-amplifying) |
| < 4% | 0 |

> ATR% > 4% means the stock regularly moves 4%+ per day — it's a natural "volatile" name.

---

### 2.4 Liquidity Rating `score × penalty`

TastyTrade's proprietary **A–F liquidity rating** combines bid/ask spreads, option volume, and open interest.

| Rating | Score | Effect |
|---|---|---|
| A, B | 5 | ✅ No penalty — excellent options liquidity |
| C | 3–4 | ✅ No penalty — acceptable |
| D | 2 | ⚠️ Score × **0.75** — poor liquidity, tradeable but costly |
| F | 1 | ⚠️ Score × **0.50** — options illiquid / untradeable |

> An F-rated stock might have great technical signals, but if you can't get filled on an option trade, the signal is useless. D-rated stocks are penalised to remain consistent with Fast Scan's pre-filter, which excludes them entirely.

### 2.5 1st Level Filter (Fast Scan Default)
By default, the scanner runs in **Fast Scan** mode to optimize performance. Before downloading heavy technical data, it **excludes** stocks that have:
- **Low Liquidity:** D or F rating (Liquidity Score ≤ 2)
- **Low Volatility Premium:** IVR < 30

*Note: You can bypass this by running with the `--full-scan` flag. In full-scan mode, D-rated stocks are kept but receive a 0.75× score penalty, and F-rated stocks are kept but receive a 0.50× score penalty.*

---

## Stage 3 — Option Chain Flow (from TastyTrade `/option-chains` + `/market-data`)

Applied to the **top 25 candidates** only (to manage API rate limits).
Looks at the **nearest expiry ≤ 14 DTE** for directional confirmation.

### 3.1 Put/Call Ratio (PCR) `±1 pt`

**PCR = Total Put Open Interest ÷ Total Call Open Interest** for near-ATM strikes.

| PCR | Meaning | Points |
|---|---|---|
| < 0.65 | Call-heavy — bullish institutional flow | **+1** (CALL) |
| > 1.50 | Put-heavy — bearish institutional flow | **−1** (PUT) |
| 0.65–1.50 | Neutral | 0 |

> PCR reflects where real money is positioned — options traders are often right about direction.

> [!NOTE]
> **Known Limitation:** PCR is computed from the **nearest expiry ≤ 14 DTE** only. Institutional hedges often sit in 30–60 DTE expirations and are not captured here. A neutral near-term PCR can coexist with heavy directional positioning in longer-dated strikes.

---

## Stage 4 — Earnings Catalyst Multiplier 🚨

The single most reliable volatility catalyst.

**If `earnings-next-date` is within 3 calendar days AND `|score| ≥ 2`:**
- Score is multiplied by **1.5×**
- Symbol is always included in output regardless of threshold
- Labeled 🚨 EARNINGS PLAY in the alert

```
Example: Score was +4.0 (CALL) with earnings in 2 days
→ Final score = 4.0 × 1.5 = +6.0 (CALL) 🚨
```

> Earnings announcements guarantee a large price move. The direction (CALL/PUT) depends on whether the stock is technically oversold or overbought going into earnings.

> [!WARNING]
> **Directional risk:** Pre-earnings price action is often distorted by institutional accumulation or distribution. A technically overbought stock can still gap up 15%+ on a beat; an oversold stock can crash further on a miss. Treat the 1.5× multiplier as a **volatility amplifier**, not a direction guarantee. Always cross-check with options flow and news sentiment before sizing a position.

---

## Full Scoring Example

> **NVDA** — hypothetical scan on a day with elevated IV before earnings

| Signal | Value | Points |
|---|---|---|
| MACD bullish crossover | Yes | +2 (raw) |
| RSI = 28 (extreme oversold) | Yes | +3 (raw) |
| **RSI+MACD correlation cap** | Both fired bullish | **capped at +4** (−1 vs raw +5) |
| BB below lower band | Yes | **+1** |
| Volume spike 3.2× + up 2.1% (not ≥3%) | Partial | 0 |
| 5-day momentum +4.8% | Yes | **+1** |
| IVR = 68 (high 🔥) | Amplifies +direction | **+1** |
| Beta = 1.9 (< 2.0 threshold) | — | 0 |
| ATR% = 5.2% | Yes | **+0.5** |
| PCR = 0.52 (call-heavy) | Yes | **+1** |
| **Sub-total** | | **= +8.5** |
| Earnings in 2 days 🚨 | 1.5× multiplier | **× 1.5 = +12.75** |
| **Score cap enforced** | Hard clamp at ±10 | **= +10 (CALL)** 🚨 |

---

## Output

The scanner returns the **Top 10 signals** ranked by `|composite score|` (highest magnitude = most extreme / highest conviction setup).

Each alert includes:
- Direction (CALL 🟢 or PUT 🔴) and score
- Earnings flag 🚨 if applicable
- IVR level with 🔥 badge
- RSI, MACD histogram, volume ratio
- 5-day trend and ATR%
- Beta and PCR
- Source watchlists (TastyTrade)
- All reasons that contributed to the score

---

## Key Insight

> **The best signals have alignment across all 4 stages:**
> 1. Technical extreme (RSI + MACD + BB all agree)
> 2. Options market elevated (IVR > 50 means professionals expect a move)
> 3. Institutional flow confirmed (PCR skewed in the same direction)
> 4. Near-term catalyst (earnings within 3 days)
>
> A stock hitting all 4 layers simultaneously is your highest-probability massive-move candidate — buy a short-dated CALL or PUT accordingly.
