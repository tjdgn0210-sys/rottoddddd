import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWeeklyProgress } from '../domain/weeklyProgress.ts';

const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
const response = () => ({ weekStart: dates[0], currentDayIndex: 3, submissionStatus: 'PENDING', submittedAt: null,
  reveals: Array.from({ length: 6 }, (_, i) => ({ dayIndex: i + 1, state: 'WAITING',
    availableAt: `${dates[i]}T00:00:00+09:00`, expiresAt: `${dates[i]}T23:59:59.999999+09:00`, consumedAt: null })) });

test('weekly metadata uses server-selected week/day and strips unlisted data', () => {
  const data = response();
  data.numbers = [1, 2, 3, 4, 5, 6];
  data.user_id = 'ignored';
  data.reveals[0].number = 45;
  const progress = parseWeeklyProgress(data);
  assert.equal(progress.weekStart, '2026-09-28'); assert.equal(progress.currentDayIndex, 3);
  assert.equal(progress.reveals.length, 6);
  assert.doesNotMatch(JSON.stringify(progress), /numbers|user_id|"number"/);
  assert.equal(parseWeeklyProgress({ ...data, currentDayIndex: null }).currentDayIndex, null);
});

test('invalid or incomplete progress cannot be displayed as a ready week', () => {
  for (const value of [null, {}, { ...response(), weekStart: '2026-09-29' },
    { ...response(), currentDayIndex: 7 }, { ...response(), submissionStatus: 'UNKNOWN' },
    { ...response(), reveals: response().reveals.slice(1) },
    { ...response(), reveals: [...response().reveals].reverse() }]) assert.throws(() => parseWeeklyProgress(value));
});
