import { REVEAL_STATES, type RevealState, type SubmissionOutcome, type WeeklyDay } from './weekly.ts';

export interface DailyRevealProgress {
  dayIndex: number;
  state: RevealState;
  availableAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface WeeklyProgress {
  weekStart: string;
  currentDayIndex: WeeklyDay | null;
  submissionStatus: 'PENDING' | SubmissionOutcome;
  submittedAt: string | null;
  reveals: DailyRevealProgress[];
}

const invalidResponse = () => new Error('주간 응답이 올바르지 않습니다. 잠시 후 다시 시도하세요.');
const isTimestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Whitelist public metadata returned by the server, never a weekly number set. */
export function parseWeeklyProgress(value: unknown): WeeklyProgress {
  if (!value || typeof value !== 'object') throw invalidResponse();
  const data = value as Record<string, unknown>;
  if (typeof data.weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.weekStart)
    || new Date(`${data.weekStart}T00:00:00Z`).getUTCDay() !== 1
    || !(data.currentDayIndex === null || (Number.isInteger(data.currentDayIndex) && Number(data.currentDayIndex) >= 1 && Number(data.currentDayIndex) <= 6))
    || !['PENDING', 'SUCCESS', 'FAILURE'].includes(String(data.submissionStatus))
    || !(data.submittedAt === null || isTimestamp(data.submittedAt))
    || !Array.isArray(data.reveals) || data.reveals.length !== 6) throw invalidResponse();
  const reveals = data.reveals.map((item: unknown, index): DailyRevealProgress => {
    if (!item || typeof item !== 'object') throw invalidResponse();
    const row = item as Record<string, unknown>;
    if (row.dayIndex !== index + 1 || !REVEAL_STATES.includes(row.state as RevealState)
      || !isTimestamp(row.availableAt) || !isTimestamp(row.expiresAt)
      || Date.parse(row.availableAt) >= Date.parse(row.expiresAt)
      || !(row.consumedAt === null || isTimestamp(row.consumedAt))) throw invalidResponse();
    return { dayIndex: row.dayIndex as number, state: row.state as RevealState,
      availableAt: row.availableAt as string, expiresAt: row.expiresAt as string, consumedAt: row.consumedAt as string | null };
  });
  return { weekStart: data.weekStart, currentDayIndex: data.currentDayIndex as WeeklyDay | null,
    submissionStatus: data.submissionStatus as WeeklyProgress['submissionStatus'], submittedAt: data.submittedAt as string | null, reveals };
}
