import type { SubmissionOutcome } from './weekly.ts';

export interface WeeklyPointsResult {
  consecutiveSuccessWeeks: number;
  pointsAwarded: number;
}

export function applyWeeklyPointsResult(
  previousConsecutiveSuccessWeeks: number,
  outcome: SubmissionOutcome,
): WeeklyPointsResult {
  if (!Number.isInteger(previousConsecutiveSuccessWeeks) || previousConsecutiveSuccessWeeks < 0) {
    throw new RangeError('Previous streak must be a non-negative integer.');
  }
  if (outcome === 'FAILURE') return { consecutiveSuccessWeeks: 0, pointsAwarded: 0 };

  const consecutiveSuccessWeeks = previousConsecutiveSuccessWeeks + 1;
  const bonus = consecutiveSuccessWeeks >= 12 ? 5
    : consecutiveSuccessWeeks >= 8 ? 3
      : consecutiveSuccessWeeks >= 4 ? 2
        : consecutiveSuccessWeeks >= 2 ? 1
          : 0;
  return { consecutiveSuccessWeeks, pointsAwarded: Math.min(15, 10 + bonus) };
}
