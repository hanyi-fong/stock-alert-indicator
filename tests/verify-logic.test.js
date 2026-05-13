import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateVerificationStatus } from '../src/verify-history.js';

test('Verification Logic Suite', async (t) => {
  const VERIFY_DAYS = 10;
  const TARGET_PROFIT_PCT = 30;
  const STOP_LOSS_PCT = 30;

  const mockDate = new Date('2026-05-01T00:00:00Z');
  
  const createCandle = (high, low, close) => ({
    date: mockDate,
    high,
    low,
    close
  });

  await t.test('CALL: Early WIN when hits +30%', () => {
    const track = { direction: 'CALL' };
    const startPrice = 100;
    // Day 1: high 110 (+10%)
    // Day 2: high 135 (+35%) -> WIN
    const candles = [
      createCandle(110, 95, 105),
      createCandle(135, 100, 130)
    ];

    const result = calculateVerificationStatus(track, startPrice, candles, VERIFY_DAYS, TARGET_PROFIT_PCT, STOP_LOSS_PCT);
    assert.equal(result.status, 'WIN');
    assert.equal(result.exitReason, 'TARGET_PROFIT');
    assert.equal(result.daysHeld, 2);
    assert.equal(result.maxExcursionPct, 35);
  });

  await t.test('PUT: Early WIN when hits unfavorable -30% meaning price dropped 30%', () => {
    const track = { direction: 'PUT' };
    const startPrice = 100;
    // PUT win is when price DROPS. So low = 70 means +30% profit.
    // Day 1: low 90 (+10% profit)
    // Day 2: low 65 (+35% profit) -> WIN
    const candles = [
      createCandle(105, 90, 95),
      createCandle(90, 65, 70)
    ];

    const result = calculateVerificationStatus(track, startPrice, candles, VERIFY_DAYS, TARGET_PROFIT_PCT, STOP_LOSS_PCT);
    assert.equal(result.status, 'WIN');
    assert.equal(result.exitReason, 'TARGET_PROFIT');
    assert.equal(result.daysHeld, 2);
    assert.equal(result.maxExcursionPct, 35);
  });

  await t.test('CALL: Early LOSS when hits -30%', () => {
    const track = { direction: 'CALL' };
    const startPrice = 100;
    // Day 1: low 90 (-10%)
    // Day 2: low 60 (-40%) -> LOSS
    const candles = [
      createCandle(105, 90, 95),
      createCandle(80, 60, 65)
    ];

    const result = calculateVerificationStatus(track, startPrice, candles, VERIFY_DAYS, TARGET_PROFIT_PCT, STOP_LOSS_PCT);
    assert.equal(result.status, 'LOSS');
    assert.equal(result.exitReason, 'STOP_LOSS');
    assert.equal(result.daysHeld, 2);
  });

  await t.test('PUT: Early LOSS when price spikes 30%', () => {
    const track = { direction: 'PUT' };
    const startPrice = 100;
    // PUT loss is when price GOES UP. high = 135 means -35% loss.
    const candles = [
      createCandle(105, 95, 100),
      createCandle(135, 100, 130)
    ];

    const result = calculateVerificationStatus(track, startPrice, candles, VERIFY_DAYS, TARGET_PROFIT_PCT, STOP_LOSS_PCT);
    assert.equal(result.status, 'LOSS');
    assert.equal(result.exitReason, 'STOP_LOSS');
    assert.equal(result.daysHeld, 2);
  });

  await t.test('CALL: Same-day hit both +30% and -30%, favors STOP_LOSS', () => {
    const track = { direction: 'CALL' };
    const startPrice = 100;
    // Day 1: high 140 (+40%), low 50 (-50%)
    const candles = [
      createCandle(140, 50, 100)
    ];

    const result = calculateVerificationStatus(track, startPrice, candles, VERIFY_DAYS, TARGET_PROFIT_PCT, STOP_LOSS_PCT);
    assert.equal(result.status, 'LOSS');
    assert.equal(result.exitReason, 'STOP_LOSS');
  });

  await t.test('CALL: Reaches VERIFY_DAYS and is OPEN but final is profitable', () => {
    const track = { direction: 'CALL' };
    const startPrice = 100;
    // 10 days of slight variations
    const candles = Array(10).fill(createCandle(105, 95, 101)); 

    const result = calculateVerificationStatus(track, startPrice, candles, VERIFY_DAYS, TARGET_PROFIT_PCT, STOP_LOSS_PCT);
    assert.equal(result.status, 'WIN');
    assert.equal(result.exitReason, 'TIME_EXPIRED');
    assert.equal(result.daysHeld, 10);
  });

  await t.test('CALL: Reaches VERIFY_DAYS and is OPEN but final is loss', () => {
    const track = { direction: 'CALL' };
    const startPrice = 100;
    // 10 days, ends at 99
    const candles = Array(10).fill(createCandle(105, 95, 99));

    const result = calculateVerificationStatus(track, startPrice, candles, VERIFY_DAYS, TARGET_PROFIT_PCT, STOP_LOSS_PCT);
    assert.equal(result.status, 'LOSS');
    assert.equal(result.exitReason, 'TIME_EXPIRED');
    assert.equal(result.daysHeld, 10);
  });

  await t.test('CALL: Stays OPEN if days < VERIFY_DAYS and no thresholds hit', () => {
    const track = { direction: 'CALL' };
    const startPrice = 100;
    // Only 5 days
    const candles = Array(5).fill(createCandle(105, 95, 101));

    const result = calculateVerificationStatus(track, startPrice, candles, VERIFY_DAYS, TARGET_PROFIT_PCT, STOP_LOSS_PCT);
    assert.equal(result.status, 'OPEN');
    assert.equal(result.exitReason, null);
    assert.equal(result.daysHeld, 5);
  });
});
