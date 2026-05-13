import fs from "fs";
import path from "path";

const isLocalTest = process.env.GITHUB_ACTIONS !== "true";
const HISTORY_DIR = path.join(process.cwd(), isLocalTest ? "local/history" : "history");

// Ensure history directory exists
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

/**
 * Detect the indicator key from a reason message string.
 * Maps human-readable reason text back to the breakdown key.
 */
function detectIndicator(message) {
  const m = message.toLowerCase();
  if (m.startsWith("rsi+macd"))                       return "correlationCap";
  if (m.startsWith("rsi"))                             return "rsi";
  if (m.startsWith("bb"))                              return "bb";
  if (m.startsWith("macd"))                            return "macd";
  if (m.includes("overextended") || m.startsWith("5d momentum")) return "momentum";
  if (m.startsWith("atr"))                             return "atr";
  if (m.startsWith("ivr"))                             return "ivr";
  if (m.startsWith("beta"))                            return "beta";
  if (m.includes("liquidity"))                         return "liquidity";
  if (m.startsWith("pcr"))                             return "pcr";
  if (m.includes("earnings"))                          return "earnings";
  if (m.startsWith("volume"))                          return "volume";
  return null;
}

/**
 * Get the current date in YYYY-MM-DD format (Eastern Time).
 */
function getDateString() {
  const date = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Save scan signals to a JSON file.
 * @param {Array} signals
 * @param {string} session - e.g. "morning", "afternoon", "manual-record"
 */
export function saveScanResult(signals, session) {
  const dateStr = getDateString();
  let filePath;

  if (session === "manual") {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const datetimeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const manualDir = path.join(HISTORY_DIR, "manual");
    if (!fs.existsSync(manualDir)) {
      fs.mkdirSync(manualDir, { recursive: true });
    }
    filePath = path.join(manualDir, `${datetimeStr}.json`);
  } else {
    const filename = session.startsWith("manual") ? `${session}.json` : `${dateStr}-${session}.json`;
    filePath = path.join(HISTORY_DIR, filename);
  }

  const payload = {
    timestamp: new Date().toISOString(),
    session,
    signals: signals.map(s => {
      // Merge breakdown into reasons: each reason gets an indicator key and numeric score.
      // The breakdown object is dropped — reasons is now the single source of truth.
      const enrichedReasons = (s.reasons || []).map(r => {
        const match = r.match(/^(.*?) \(([+-]?[\d.]+)\)$/);
        const message = match ? match[1].trim() : r;
        const score   = match ? parseFloat(match[2]) : undefined;
        const indicator = detectIndicator(message);

        const entry = { indicator, message };
        if (score !== undefined) entry.score = score;
        return entry;
      });

      // Destructure to drop breakdown from the saved payload
      const { breakdown, reasons, ...rest } = s; // eslint-disable-line no-unused-vars
      return { ...rest, reasons: enrichedReasons };
    }),
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`💾 Saved ${signals.length} signals to ${filePath}`);
}

/**
 * Load the morning's scan results (or a manual record) for the current day.
 * @param {string} session - e.g. "morning", "manual-record"
 * @returns {Array|null} Array of signals, or null if not found
 */
export function loadPreviousResult(session = "morning") {
  const dateStr = getDateString();
  const filename = session.startsWith("manual") ? `${session}.json` : `${dateStr}-${session}.json`;
  const filePath = path.join(HISTORY_DIR, filename);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ No history file found at ${filePath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const payload = JSON.parse(content);
    console.log(`📂 Loaded ${payload.signals?.length || 0} signals from ${filePath}`);
    return payload.signals || [];
  } catch (err) {
    console.error(`❌ Failed to read history file: ${err.message}`);
    return null;
  }
}

/**
 * Save verification results.
 * @param {Array} verificationData 
 * @param {string} session 
 */
export function saveVerificationResult(verificationData, session = "afternoon") {
  const dateStr = getDateString();
  const suffix = session.includes("manual") ? "manual-verify" : `${dateStr}-verification`;
  const filePath = path.join(HISTORY_DIR, `${suffix}.json`);

  const payload = {
    timestamp: new Date().toISOString(),
    verificationData,
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`💾 Saved verification results to ${filePath}`);
}
