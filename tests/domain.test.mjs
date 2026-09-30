import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWeeklyPointsResult } from '../domain/points.ts';
import { canTransitionRevealState, generateWeeklyNumbers, getWeeklyCalendarContext, submitWeeklyNumbers } from '../domain/weekly.ts';

const correct = [3, 8, 14, 22, 31, 45];

test('weekly generation returns six unique integers in the allowed range', () => {
  let sample = 0;
  const numbers = generateWeeklyNumbers(() => (sample++ % 10) / 10);
  assert.equal(numbers.length, 6);
  assert.equal(new Set(numbers).size, 6);
  assert.ok(numbers.every((number) => Number.isInteger(number) && number >= 1 && number <= 45));
});

test('weekly day follows the backend Seoul boundary', () => {
  const monday = getWeeklyCalendarContext(new Date('2026-09-27T16:00:00Z'));
  assert.equal(monday.day, 1);
  assert.equal(monday.weekStartsOn, '2026-09-28');
  const sunday = getWeeklyCalendarContext(new Date('2026-09-26T16:00:00Z'));
  assert.equal(sunday.day, null);
  assert.equal(sunday.weekStartsOn, '2026-09-21');
});

test('reveal state machine accepts only forward edges and terminal states stay terminal', () => {
  assert.equal(canTransitionRevealState('WAITING', 'AVAILABLE'), true);
  assert.equal(canTransitionRevealState('AVAILABLE', 'REVEAL_READY'), true);
  assert.equal(canTransitionRevealState('REVEAL_READY', 'CONSUMED'), true);
  assert.equal(canTransitionRevealState('CONSUMED', 'LOCKED'), true);
  assert.equal(canTransitionRevealState('AVAILABLE', 'EXPIRED'), true);
  assert.equal(canTransitionRevealState('LOCKED', 'AVAILABLE'), false);
  assert.equal(canTransitionRevealState('LOCKED', 'REVEAL_READY'), false);
  assert.equal(canTransitionRevealState('EXPIRED', 'AVAILABLE'), false);
  assert.equal(canTransitionRevealState('CONSUMED', 'AVAILABLE'), false);
});

test('submission validates a single final attempt without returning the answer', () => {
  assert.deepEqual(submitWeeklyNumbers(correct, [45, 31, 22, 14, 8, 3], true, false), { accepted: true, attemptUsed: true, outcome: 'SUCCESS' });
  assert.deepEqual(submitWeeklyNumbers(correct, [1, 2, 4, 6, 9, 11], true, false), { accepted: true, attemptUsed: true, outcome: 'FAILURE' });
  assert.deepEqual(submitWeeklyNumbers(correct, [3, 8, 14, 22, 31], true, false), { accepted: false, reason: 'WRONG_COUNT' });
  assert.deepEqual(submitWeeklyNumbers(correct, [3, 8, 14, 22, 31, 31], true, false), { accepted: false, reason: 'DUPLICATES' });
  assert.deepEqual(submitWeeklyNumbers(correct, [3, 8, 14, 22, 31, 45], true, true), { accepted: false, reason: 'ALREADY_SUBMITTED' });
  assert.deepEqual(submitWeeklyNumbers(correct, [3, 8, 14, 22, 31, 45], false, false), { accepted: false, reason: 'NOT_READY' });
});

test('weekly points follow streak tiers and failure resets the streak', () => {
  assert.deepEqual(applyWeeklyPointsResult(0, 'SUCCESS'), { consecutiveSuccessWeeks: 1, pointsAwarded: 10 });
  assert.deepEqual(applyWeeklyPointsResult(1, 'SUCCESS'), { consecutiveSuccessWeeks: 2, pointsAwarded: 11 });
  assert.deepEqual(applyWeeklyPointsResult(3, 'SUCCESS'), { consecutiveSuccessWeeks: 4, pointsAwarded: 12 });
  assert.deepEqual(applyWeeklyPointsResult(7, 'SUCCESS'), { consecutiveSuccessWeeks: 8, pointsAwarded: 13 });
  assert.deepEqual(applyWeeklyPointsResult(11, 'SUCCESS'), { consecutiveSuccessWeeks: 12, pointsAwarded: 15 });
  assert.equal(applyWeeklyPointsResult(50, 'SUCCESS').pointsAwarded, 15);
  assert.deepEqual(applyWeeklyPointsResult(8, 'FAILURE'), { consecutiveSuccessWeeks: 0, pointsAwarded: 0 });
});
