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
| Earnings override | CALL or PUT | Even score ≥ \|2\| is alerted if earnings within 3 days |

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
| 5-day momentum ≥ +4% | **+1** (CALL — strong uptrend) |
| 5-day momentum ≤ −4% | **−1** (PUT — strong downtrend) |

---

## Stage 2 — Options Market Signals (from TastyTrade `/market-metrics`)

These signals come from TastyTrade's market intelligence — what professional options traders are pricing in.

### 2.1 IVR — Implied Volatility Rank `up to ±1.5 pts`

**IVR (0–100)** tells you how expensive options are compared to the past 52 weeks.
- **High IVR = options market expects a big move**
- IVR > 50 means IV is in the top 50th percentile of the past year

The IVR bonus **amplifies the existing direction** (adds to CALL score if positive, to PUT score if negative):

| IVR Level | Bonus | Label |
|---|---|---|
| ≥ 75 | **±1.5** | 🔥🔥 Very high — strong move priced in |
| 50–74 | **±1.0** | 🔥 High |
| 30–49 | **±0.5** | Elevated |
| < 30 | 0 | Normal |

> High IVR alone doesn't tell direction — it just confirms the market expects big movement. Combined with technical direction, it's a powerful amplifier.

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

### 2.4 Liquidity Rating (filter) `score × 0.5 penalty`

TastyTrade's proprietary **A–F liquidity rating** combines bid/ask spreads, option volume, and open interest.

| Rating | Effect |
|---|---|
| A, B | ✅ No penalty — good options liquidity |
| C, D | ✅ No penalty — acceptable |
| F | ⚠️ Score halved — options are illiquid/untradeable |

> An F-rated stock might have great technical signals, but if you can't get filled on an option trade, the signal is useless.

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

---

## Full Scoring Example

> **NVDA** — hypothetical scan on a day with elevated IV before earnings

| Signal | Value | Points |
|---|---|---|
| MACD bullish crossover | Yes | **+2** |
| RSI = 28 (extreme oversold) | Yes | **+3** |
| BB below lower band | Yes | **+1** |
| Volume spike 3.2× + up 2.1% (not ≥3%) | Partial | 0 |
| 5-day momentum +4.8% | Yes | **+1** |
| IVR = 68 (high 🔥) | Amplifies +direction | **+1** |
| Beta = 1.9 (< 2.0 threshold) | — | 0 |
| ATR% = 5.2% | Yes | **+0.5** |
| PCR = 0.52 (call-heavy) | Yes | **+1** |
| Earnings in 2 days 🚨 | 1.5× multiplier | — |
| **Raw score before multiplier** | | **= +9.5** |
| **Earnings 1.5× multiplier** | | **× 1.5** |
| **Final composite score** | | **= +10 (CALL)** |

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
