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

### Running Locally (No Recording)

The standard commands will scan the market and send an alert to Google Chat, but will **not** record history files or trigger any verification:

```bash
# 1. Install dependencies
npm install

# 2. Run a default scan (Fast Scan)
npm run scan

# 3. Run a comprehensive scan (Full Market)
npm run scan:full

# 4. Dry run (only prints to terminal, no Google Chat alerts)
npm run test
```

### Verification & Lifecycle Tracking

The scanner includes an advanced automated engine that tracks the lifecycle of every generated signal.

**Win/Loss Logic:**
- **WIN**: The signal hits `+30%` profit before hitting the stop loss or expiring.
- **LOSS**: The signal hits `-30%` stop loss before hitting the target profit.
- **Expiration**: If it holds for 10 trading days (excluding weekends and market holidays) without hitting either target, it is resolved to a WIN or LOSS depending on the return on the 10th trading day.

You can configure the thresholds via `.env`:
```env
VERIFY_DAYS=10
TARGET_PROFIT_PCT=30
STOP_LOSS_PCT=30
```

```bash
# 1. Run a morning scan and record results
npm run scan:morning

# 2. Run an afternoon scan and record results
npm run scan:afternoon

# 3. Run the verification engine
node src/verify-history.js
```

*   **Morning/Afternoon Scans:** Generate signals and save them to `history/YYYY-MM-DD-morning.json` and `history/YYYY-MM-DD-afternoon.json`.
*   **10-Day Lifecycle Engine:** The `verify-history.js` script parses all history files. When a ticker is detected, it is tracked for the next 10 days (or until its direction reverses). Daily closing prices and max favorable excursion data are calculated using Yahoo Finance and saved to `history/verification-report.json`.
*   **GitHub Actions Automation:** 
    * The scanner runs daily at 9:35 AM and 3:30 PM ET.
    * The verifier runs daily at 4:00 PM ET as a separate job.
    * All history and verification data is automatically committed back to the repository.

### Running Tests

We use the native Node.js test runner for unit tests. To verify the math and logic of the win/loss calculation:
```bash
npm test
```

### Visual UI Testing (Dashboard)

To test the GitHub Pages dashboard locally with synthetic WIN, LOSS, and OPEN scenarios:
```bash
npm run test:ui
```
Then, you can preview the generated data in your browser.

### GitHub Pages Dashboard
A premium, dark-mode dashboard is included to visually track the performance of your signals over their 10-day lifespan.

**To Enable GitHub Pages:**
1. Go to your repository **Settings** → **Pages**.
2. Under "Build and deployment", set the **Source** to "Deploy from a branch".
3. Select your `master` (or main) branch, and choose the `/docs` folder.
4. Click **Save**. Your verification dashboard will be live in a few minutes!

**Local Preview:**
To preview the dashboard locally and ensure it has access to your `/local` history files:
```bash
# Run from the project root (to allow access to /local folder)
npx serve .
```
Then open `http://localhost:3000/docs/index.html` in your browser.


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
