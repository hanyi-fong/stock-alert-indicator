import fs from 'fs';
import path from 'path';

const isLocalTest = process.env.GITHUB_ACTIONS !== "true";
const docsDir = path.join(process.cwd(), isLocalTest ? "local" : "docs");
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const docsDataPath = path.join(docsDir, "data.json");

const VERIFY_DAYS = 10;
const TARGET_PROFIT_PCT = 30;
const STOP_LOSS_PCT = 30;

function createTrack(ticker, direction, startPrice, days, trajectory, status, maxExcursionPct, currentReturnPct) {
    const dailyChanges = [];
    let currentPrice = startPrice;

    for (let i = 0; i < days; i++) {
        // Create a "bumpy" random walk path
        // We want to end up roughly at the trajectory, but with ups and downs
        const trendPerDay = trajectory / days;
        const volatility = 8; // +/- 4% random noise daily
        const noise = (Math.random() * volatility) - (volatility / 2);
        
        // Apply change to currentPrice
        const dailyChangePct = trendPerDay + noise;
        currentPrice = currentPrice * (1 + (dailyChangePct / 100));

        let pctChange = ((currentPrice - startPrice) / startPrice) * 100;
        if (direction === "PUT") {
            pctChange = -pctChange; // For put, price going down is positive return
        }

        // Backtrack business days to exclude weekends
        let businessDaysToSubtract = days - i;
        const date = new Date();
        while (businessDaysToSubtract > 0) {
            date.setDate(date.getDate() - 1);
            if (date.getDay() !== 0 && date.getDay() !== 6) { // skip Sunday (0) and Saturday (6)
                businessDaysToSubtract--;
            }
        }

        dailyChanges.push({
            day: i,
            date: date.toISOString().split('T')[0],
            close: parseFloat(currentPrice.toFixed(2)),
            pctChange: parseFloat(pctChange.toFixed(2))
        });
    }

    let startBusinessDaysToSubtract = days;
    const detectedDate = new Date();
    while (startBusinessDaysToSubtract > 0) {
        detectedDate.setDate(detectedDate.getDate() - 1);
        if (detectedDate.getDay() !== 0 && detectedDate.getDay() !== 6) {
            startBusinessDaysToSubtract--;
        }
    }

    return {
        ticker,
        direction,
        score: 8.5,
        isEarningsPlay: false,
        dateDetected: detectedDate.toISOString(),
        startPrice: parseFloat(startPrice.toFixed(2)),
        dailyChanges,
        maxExcursionPct: parseFloat(maxExcursionPct.toFixed(2)),
        status,
        daysHeld: days,
        exitReason: status === "WIN" ? "TARGET_PROFIT" : (status === "LOSS" ? "STOP_LOSS" : null)
    };
}

const mockTracks = [
    // 1. A clear WIN (Call)
    createTrack("AAPL", "CALL", 150, 4, 32, "WIN", 35.2, 32.1),
    // 2. A clear LOSS (Call)
    createTrack("TSLA", "CALL", 200, 3, -31, "LOSS", 2.1, -31.5),
    // 3. An OPEN trade doing well (Call)
    createTrack("NVDA", "CALL", 400, 6, 15, "OPEN", 18.5, 15.2),
    // 4. An OPEN trade doing poorly (Call)
    createTrack("AMD", "CALL", 100, 5, -10, "OPEN", 1.0, -10.4),
    // 5. A clear WIN (Put - price dropped 32%)
    createTrack("META", "PUT", 300, 2, -32, "WIN", 34.0, 32.1),
    // 6. A clear LOSS (Put - price spiked 35%)
    createTrack("NFLX", "PUT", 450, 4, 35, "LOSS", 0.0, -35.2),
    // 7. Time Expired WIN (Call - held 10 days, ended up 12%)
    createTrack("MSFT", "CALL", 300, 10, 12, "WIN", 15.0, 12.0),
    // 8. Time Expired LOSS (Put - held 10 days, ended up losing 5%)
    createTrack("AMZN", "PUT", 120, 10, 5, "LOSS", 5.0, -5.0)
];

mockTracks[6].exitReason = "TIME_EXPIRED";
mockTracks[7].exitReason = "TIME_EXPIRED";

const completed = mockTracks.filter(t => t.status !== "OPEN");
const wins = completed.filter(t => t.status === "WIN").length;
const losses = completed.filter(t => t.status === "LOSS").length;
const winRate = completed.length > 0 ? ((wins / completed.length) * 100).toFixed(2) + "%" : "0.00%";

const payload = {
    updatedAt: new Date().toISOString(),
    verifyDays: VERIFY_DAYS,
    targetProfitPct: TARGET_PROFIT_PCT,
    stopLossPct: STOP_LOSS_PCT,
    stats: {
      total: mockTracks.length,
      completed: completed.length,
      open: mockTracks.length - completed.length,
      wins,
      losses,
      winRate
    },
    tracks: mockTracks
};

fs.writeFileSync(docsDataPath, JSON.stringify(payload, null, 2), "utf8");
console.log(`✅ Mock UI data generated at ${docsDataPath}`);
if (isLocalTest) {
    console.log(`   (Saved to local/ since you are running locally)`);
} else {
    console.log(`   You can now open docs/index.html in your browser to view the dashboard.`);
}
