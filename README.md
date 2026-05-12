# Stock Alert Scanner 📈 (TastyTrade Enhanced)

A professional-grade stock scanner designed to find high-probability setups for massive price moves. It combines technical analysis with real-time options market intelligence from the TastyTrade API. 

It targets **coiled springs** — stocks with aligned technicals, elevated implied volatility (IV), institutional options flow, and near-term catalysts (earnings) — and alerts you via Google Chat to buy short-dated CALL or PUT options.

## How it Works

The scanner operates in 4 stages to generate a **Composite Score (-10 to +10)**:

1. **Universe Building:** Curates a dynamic list of highly liquid, optionable stocks from TastyTrade's public watchlists (e.g., "High Options Volume", "Liquid Symbols", "tasty IVR").
2. **Options Market Intelligence:** Fetches IVR, Beta, Liquidity Ratings, and upcoming earnings dates directly from TastyTrade.
3. **Technical Scan:** Evaluates 60 days of OHLCV data using MACD, RSI, Bollinger Bands, Volume, ATR, and 5-day momentum.
4. **Institutional Flow:** Extracts the Put/Call Ratio (PCR) from near-ATM options for the top candidates to confirm the "smart money" direction.

*(See [SCORING.md](./SCORING.md) for a deep dive into exactly how the score is calculated).*

## Setup (Local & GitHub Actions)

### 1. Clone and Install
```bash
git clone <your-repo-url>
cd stock-alert-scanner
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root of the project:

```bash
# .env
GOOGLE_CHAT_WEBHOOK="https://chat.googleapis.com/v1/spaces/..."
TASTYTRADE_CLIENT_SECRET="your_tastytrade_client_secret"
TASTYTRADE_REFRESH_TOKEN="your_tastytrade_refresh_token"

# Optional overrides
# WATCHLIST="NVDA,TSLA,AMD"
# TASTYTRADE_WATCHLISTS="Tasty,Liquid,High IV"
```

### 3. Run Locally (Dry Run)
To run a test scan locally without sending an actual alert to Google Chat, use the `--dry-run` flag. Node 20's built-in `--env-file` flag is used to load your `.env`:

```bash
npm test
# OR
node --env-file=.env src/index.js --dry-run
```

To run a real scan and send the alert:
```bash
npm run scan
# OR
node --env-file=.env src/index.js
```

### 4. Deploy to GitHub Actions
To automate the scanner so it runs every weekday near market open and close, push to GitHub and set up your repository Secrets.

```bash
git add .
git commit -m "Add TastyTrade scanner updates"
git push origin master
```

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**:

**Add Repository Secrets:**
- `GOOGLE_CHAT_WEBHOOK`
- `TASTYTRADE_CLIENT_SECRET`
- `TASTYTRADE_REFRESH_TOKEN`

**Optional Variables** (Add under the "Variables" tab, not "Secrets"):
- `WATCHLIST`: Overrides the scan universe with a specific, comma-separated list of symbols (e.g., `AAPL,MSFT`).
- `TASTYTRADE_WATCHLISTS`: Comma-separated list of TastyTrade public watchlists to use (set to `ALL` to scan all 2400+ symbols).

The scanner will now run automatically at **9:35 AM and 3:45 PM ET, Monday–Friday**.

## Manual GitHub Action Run
You can manually trigger the workflow anytime:
Go to your GitHub repo → **Actions** → **Stock Scanner** → **Run workflow**

## Disclaimer
This tool is for educational purposes only. Options trading involves significant risk and can result in the loss of capital. Always do your own research before placing any trade.
