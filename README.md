# Stock Alert Scanner 📈

Scans a watchlist for CALL/PUT signals using MACD, RSI, Bollinger Bands, and volume spikes. Sends alerts to Google Chat. Runs automatically on GitHub Actions — no laptop needed.

## What triggers a signal?

Each indicator contributes a score. A score ≥ 2 = CALL alert, ≤ -2 = PUT alert.

| Indicator | CALL (+) | PUT (-) | Score |
|---|---|---|---|
| MACD | Bullish crossover | Bearish crossover | ±2 |
| RSI | Oversold (< 30) | Overbought (> 70) | ±2 |
| Bollinger Bands | Price touches lower band | Price breaks upper band | ±1 |
| Volume + Move | Spike + big up day | Spike + big down day | ±1 |

## Setup (5 steps)

### 1. Clone and install
```bash
git clone <your-repo-url>
cd stock-alert
npm install
```

### 2. Add your Google Chat webhook
Go to your Google Chat space → Apps & integrations → Webhooks → Copy the URL.

### 3. Test locally
```bash
GOOGLE_CHAT_WEBHOOK="https://chat.googleapis.com/v1/spaces/..." node src/index.js --dry-run
```

### 4. Push to GitHub
```bash
git add .
git commit -m "init"
git push
```

### 5. Add webhook as GitHub Secret
GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

- Name: `GOOGLE_CHAT_WEBHOOK`
- Value: your webhook URL

That's it. The scanner runs automatically at **9:35 AM and 3:45 PM ET, Monday–Friday**.

## Customise

Edit `src/watchlist.js` to:
- Change the list of tickers
- Adjust RSI thresholds, volume multiplier, BB settings, etc.

## Manual run

Go to your GitHub repo → **Actions** → **Stock Scanner** → **Run workflow**

## Disclaimer

This is for educational purposes only. Options trading involves significant risk. Always do your own research before placing any trade.
