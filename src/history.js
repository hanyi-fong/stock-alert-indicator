import fs from "fs";
import path from "path";

const HISTORY_DIR = path.join(process.cwd(), "history");

// Ensure history directory exists
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
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
  const filename = session.startsWith("manual") ? `${session}.json` : `${dateStr}-${session}.json`;
  const filePath = path.join(HISTORY_DIR, filename);

  const payload = {
    timestamp: new Date().toISOString(),
    session,
    signals,
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
