# Stock Alert Scanner 📈 (TastyTrade Enhanced)

A professional-grade stock scanner designed to find high-probability setups for massive price moves. It combines technical analysis with real-time options market intelligence from the TastyTrade API. 

It targets **coiled springs** — stocks with aligned technicals, elevated implied volatility (IV), institutional options flow, and near-term catalysts (earnings) — and alerts you via Google Chat to buy short-dated CALL or PUT options.

## How it Works

The scanner operates in 4 stages to generate a **Composite Score (-10 to +10)**:

1. **Universe Building:** Curates a dynamic list of highly liquid, optionable stocks from TastyTrade's public watchlists (e.g., "High Options Volume", "Liquid Symbols", "tasty IVR").
2. **Options Market Intelligence:** Fetches IVR, Beta, Liquidity Ratings, and upcoming earnings dates directly from TastyTrade.
3. **1st Level Filter (Fast Scan):** By default, the scanner skips stocks with low liquidity (D or F rating) or low IVR (< 30) to save API calls and speed up execution. (Use `--full-scan` to bypass).
4. **Technical Scan:** Evaluates 60 days of OHLCV data using MACD, RSI, Bollinger Bands, Volume, ATR, and 5-day momentum.
5. **Institutional Flow:** Extracts the Put/Call Ratio (PCR) from near-ATM options for the top candidates to confirm the "smart money" direction.

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

### Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Run a default scan (Fast Scan)
npm run scan

# 3. Run a comprehensive scan (Full Market)
npm run scan:full

# 4. Dry run (no alerts sent)
npm run test
```

### Verification & History Tracking

The scanner includes an automated engine to record predictions and verify intraday performance:

```bash
# 1. Run a morning scan and record results
npm run scan:morning

# 2. Run an afternoon scan, record results, and VERIFY the morning signals
npm run scan:afternoon

# 3. Manually record and verify a custom scan
npm run scan:manual-record
npm run scan:manual-verify
```

*   **Morning Scan (9:35 AM):** Generates `history/YYYY-MM-DD-morning.json`.
*   **Afternoon Scan (3:30 PM):** Generates `history/YYYY-MM-DD-afternoon.json`. It also reads the morning file, fetches intraday data (highs/lows/current price) to calculate the max favorable excursion, and saves `history/YYYY-MM-DD-verification.json`.
*   **GitHub Actions:** Automatically runs morning and afternoon scans, sends a verification report to Google Chat at 3:30 PM, and commits the JSON files back to this repository for historical tracking.

### 4. Fast Scan vs Full Scan
By default, the scanner runs in **Fast Scan** mode, which filters out low-potential stocks (poor liquidity or low IVR) before the technical analysis phase. This significantly improves performance and avoids API rate limits.

To scan *every* optionable stock (only excluding F-rated liquidity):
```bash
npm run scan:full
# OR
node --env-file=.env src/index.js --full-scan
```

### 5. Deploy to GitHub Actions
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
- You can check the **Run Full Scan** box to trigger a `--full-scan` bypass.

## Disclaimer
This tool is for educational purposes only. Options trading involves significant risk and can result in the loss of capital. Always do your own research before placing any trade.
