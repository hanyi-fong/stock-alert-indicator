import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DATA_JSON_PATH = path.join(process.cwd(), 'local/data.json');

/**
 * Helper to validate a data.json payload against the expected schema.
 */
function validateSchema(data) {
  // 1. Check Payload Root Keys
  const rootKeys = [
    'updatedAt',
    'maxTrackDays',
    'defaultVerifyDays',
    'defaultTargetPct',
    'defaultStopLossPct',
    'stats',
    'tracks'
  ];
  rootKeys.forEach(key => {
    assert.ok(key in data, `Payload missing root key: ${key}`);
  });

  // 2. Check Stats Keys
  const statsKeys = [
    'total',
    'completed',
    'open',
    'wins',
    'losses',
    'winRate',
    'targetWins',
    'stopLosses',
    'expiredWins',
    'expiredLoss'
  ];
  statsKeys.forEach(key => {
    assert.ok(key in data.stats, `Stats missing key: ${key}`);
  });

  // 3. Check Track Keys (sample first track)
  if (data.tracks.length > 0) {
    const track = data.tracks[0];
    const trackKeys = [
      'trackId',
      'ticker',
      'direction',
      'score',
      'isEarningsPlay',
      'dateDetected',
      'startPrice',
      'dailyChanges',
      'maxExcursionPct',
      'defaultTargetPct',
      'defaultStopLossPct',
      'defaultExpiryDays',
      'status',
      'daysHeld',
      'exitReason',
      'triggerDay'
    ];
    trackKeys.forEach(key => {
      assert.ok(key in track, `Track missing key: ${key}`);
    });

    // 4. Check Daily Change Keys
    if (track.dailyChanges.length > 0) {
      const change = track.dailyChanges[0];
      const changeKeys = ['day', 'date', 'close', 'pctChange'];
      changeKeys.forEach(key => {
        assert.ok(key in change, `Daily change missing key: ${key}`);
      });
    }
  }
}

test('Schema Consistency: generate-mock-data.js', () => {
  console.log('Running scripts/generate-mock-data.js...');
  execSync('node scripts/generate-mock-data.js', { stdio: 'ignore' });
  
  const content = fs.readFileSync(DATA_JSON_PATH, 'utf8');
  const data = JSON.parse(content);
  
  validateSchema(data);
  console.log('✅ generate-mock-data.js output is schema-compliant.');
});

/**
 * Note: We don't run verify-history.js here because it requires external APIs.
 * Instead, we verify that it contains the same key-building logic by 
 * inspecting the code's object literals if possible, or we rely on the 
 * manual alignment we just did.
 * 
 * For a true unit test of verify-history.js, we would need to mock fetch().
 */
test('Static Alignment: verify-history.js keys check', () => {
  const code = fs.readFileSync(path.join(process.cwd(), 'src/verify-history.js'), 'utf8');
  
  // Check if all required stats keys are present in the payload object literal
  const requiredStats = [
    'total', 'completed', 'open', 'wins', 'losses', 'winRate', 
    'targetWins', 'stopLosses', 'expiredWins', 'expiredLoss'
  ];
  
  requiredStats.forEach(key => {
    // Matches key followed by : or , or } or whitespace
    const pattern = new RegExp(`\\b${key}\\b\\s*[:|,}]`);
    assert.ok(pattern.test(code), `verify-history.js seems to be missing stats key in payload: ${key}`);
  });

  // Check if all required track keys are present in the track initialization or assignment
  const requiredTrackKeys = [
    'trackId', 'ticker', 'direction', 'score', 'isEarningsPlay', 
    'dateDetected', 'startPrice', 'dailyChanges', 'maxExcursionPct', 
    'defaultTargetPct', 'defaultStopLossPct', 'defaultExpiryDays',
    'status', 'daysHeld', 'exitReason', 'triggerDay'
  ];

  requiredTrackKeys.forEach(key => {
    // Matches key followed by : or , or track.key
    const pattern = new RegExp(`(\\b${key}\\b\\s*[:|,}]|track\\.${key}\\s*=)`);
    assert.ok(pattern.test(code), `verify-history.js seems to be missing track key: ${key}`);
  });

  console.log('✅ verify-history.js source code is aligned with the required schema.');
});
