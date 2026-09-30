import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWeeklyProgress,parseCurrentRevealStatus,formatPublicRevealWindow } from '../domain/weeklyProgress.ts';

const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
const response = () => ({ weekStart: dates[0], currentDayIndex: 3, submissionStatus: 'PENDING', submittedAt: null,
  reveals: Array.from({ length: 6 }, (_, i) => ({ dayIndex: i + 1, state: 'WAITING',
    publicWindowStart: `${dates[i]}T13:00:00+09:00`, publicWindowEnd: `${dates[i]}T17:00:00+09:00`, consumedAt: null })) });

test('weekly metadata uses server-selected week/day and strips unlisted data', () => {
  const data = response();
  data.numbers = [1, 2, 3, 4, 5, 6];
  data.user_id = 'ignored';
  data.reveals[0].number = 45;
  data.reveals[0].exact_available_at = 'hidden';
  const progress = parseWeeklyProgress(data);
  assert.equal(progress.weekStart, '2026-09-28'); assert.equal(progress.currentDayIndex, 3);
  assert.equal(progress.reveals.length, 6);
  assert.doesNotMatch(JSON.stringify(progress), /numbers|user_id|"number"|exact_/);
  assert.equal(parseWeeklyProgress({ ...data, currentDayIndex: null }).currentDayIndex, null);
});

test('status exposes remaining seconds only while AVAILABLE, including safe Sunday metadata',()=>{
  const reveal=response().reveals[2];
  const waiting={weekStart:dates[0],currentDayIndex:3,reveal,remainingSeconds:null};
  assert.equal(parseCurrentRevealStatus(waiting).reveal.state,'WAITING');
  assert.throws(()=>parseCurrentRevealStatus({...waiting,remainingSeconds:123}));
  assert.equal(parseCurrentRevealStatus({...waiting,reveal:{...reveal,state:'AVAILABLE'},remainingSeconds:300}).remainingSeconds,300);
  assert.throws(()=>parseCurrentRevealStatus({...waiting,reveal:{...reveal,state:'AVAILABLE'},remainingSeconds:0}));
  assert.equal(parseCurrentRevealStatus({...waiting,currentDayIndex:null,reveal:null}).reveal,null);
  assert.equal(formatPublicRevealWindow(reveal),'13:00–17:00 (한국 시간)');
});

test('invalid or incomplete progress cannot be displayed as a ready week', () => {
  for (const value of [null, {}, { ...response(), weekStart: '2026-09-29' },
    { ...response(), currentDayIndex: 7 }, { ...response(), submissionStatus: 'UNKNOWN' },
    { ...response(), reveals: response().reveals.slice(1) },
    { ...response(), reveals: [...response().reveals].reverse() }]) assert.throws(() => parseWeeklyProgress(value));
});
