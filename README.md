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

# 5. Ad-hoc scan (sends alerts, but SKIPS saving history)
node --env-file=.env src/index.js --skip-history
```

### Performance Verification & Lifecycle Tracking

The scanner includes a high-fidelity automated engine that tracks the complete lifecycle of every generated signal.

**High-Fidelity Tracking:**
- **20-Day Raw Data:** Unlike basic trackers that stop after an exit is hit, our engine always collects **20 days** of price action. This allows the dashboard to simulate different scenarios even after a trade is "closed."
- **Multi-Trade Support:** Supports multiple concurrent or sequential trades for the same ticker (e.g., a `CALL` and a `PUT` on AAPL at once).
- **Win/Loss Simulation:**
    - **WIN**: Hits the target profit (default `+30%`) before hitting the stop loss or expiring.
    - **LOSS**: Hits the stop loss (default `-30%`) before hitting the target.
    - **Expiration**: If neither is hit within the expiry window (default 10 days), the trade resolves based on the return at the end of that window.

**Usage:**
```bash
# 1. Run a morning scan and record results
npm run scan:morning

# 2. Run an afternoon scan and record results
npm run scan:afternoon

# 3. Run the verification engine (collects 20 days of data per track)
node src/verify-history.js
```

*   **Morning/Afternoon Scans:** Generate signals and save them to `history/YYYY-MM-DD-morning.json` and `history/YYYY-MM-DD-afternoon.json`.
*   **10-Day Lifecycle Engine:** The `verify-history.js` script parses all history files. When a ticker is detected, it is tracked for the next 10 days (or until its direction reverses). Daily closing prices and max favorable excursion data are calculated using Yahoo Finance and saved to `history/verification-report.json`.
*   **GitHub Actions Automation:** 
    * The scanner runs daily at 9:35 AM and 3:30 PM ET.
    * The verifier runs daily at 4:00 PM ET as a separate job.
    * All history and verification data is automatically committed back to the repository.

### Testing

We use a multi-tier testing strategy to ensure reliability:

#### 1. Logic & Math Tests
Validates the pure functions for win/loss calculation and threshold logic.
```bash
npm test
```

#### 2. Visual Dashboard Testing
Generates 10 diverse mock scenarios (concurrent trades, sequential trades, tight thresholds) to test the UI.
```bash
npm run test:ui
```

#### 3. Schema Consistency Tests
Ensures that the mock data generator and the production verification engine stay in perfect sync regarding the JSON data format.
```bash
npm run test:schema
```

### GitHub Pages Dashboard
A premium, dark-mode dashboard is included to visually track performance and simulate outcomes.

**Key Features:**
- **⚙️ Global Threshold Sliders**: Adjust Target %, Stop Loss %, and Expiry Days live. The entire dashboard (Win Rate, Stats, and Cards) updates instantly.
- **Ghost Bars**: View price action collected *after* a trade was triggered (faded bars).
- **Trigger Markers**: See exactly where a trade exited with `✕` markers on the chart.
- **Persistence**: Your custom thresholds are saved to `localStorage` for your next visit.

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
