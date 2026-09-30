import { REVEAL_STATES, type RevealState, type SubmissionOutcome, type WeeklyDay } from './weekly.ts';

export interface DailyRevealProgress {
  dayIndex: number;
  state: RevealState;
  publicWindowStart: string;
  publicWindowEnd: string;
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

export function parseDailyReveal(value: unknown): DailyRevealProgress {
  if (!value || typeof value !== 'object') throw invalidResponse();
  const row = value as Record<string, unknown>;
  if (!Number.isInteger(row.dayIndex) || Number(row.dayIndex) < 1 || Number(row.dayIndex) > 6
    || !REVEAL_STATES.includes(row.state as RevealState)
    || !isTimestamp(row.publicWindowStart) || !isTimestamp(row.publicWindowEnd)
    || Date.parse(row.publicWindowStart) >= Date.parse(row.publicWindowEnd)
    || !(row.consumedAt === null || isTimestamp(row.consumedAt))) throw invalidResponse();
  return { dayIndex: row.dayIndex as number, state: row.state as RevealState,
    publicWindowStart: row.publicWindowStart as string, publicWindowEnd: row.publicWindowEnd as string,
    consumedAt: row.consumedAt as string | null };
}

export interface CurrentRevealStatus {
  weekStart: string;
  currentDayIndex: WeeklyDay | null;
  reveal: DailyRevealProgress | null;
  remainingSeconds: number | null;
}

export function parseCurrentRevealStatus(value: unknown): CurrentRevealStatus {
  if (!value || typeof value !== 'object') throw invalidResponse();
  const data = value as Record<string, unknown>;
  if (typeof data.weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.weekStart)
    || new Date(`${data.weekStart}T00:00:00Z`).getUTCDay() !== 1) throw invalidResponse();
  const reveal = data.reveal === null ? null : parseDailyReveal(data.reveal);
  if (data.currentDayIndex === null ? reveal !== null : !reveal || data.currentDayIndex !== reveal.dayIndex) throw invalidResponse();
  if (reveal?.state === 'AVAILABLE') {
    if (!Number.isInteger(data.remainingSeconds) || Number(data.remainingSeconds) <= 0) throw invalidResponse();
  } else if (data.remainingSeconds !== null) throw invalidResponse();
  return { weekStart: data.weekStart, currentDayIndex: data.currentDayIndex as WeeklyDay | null,
    reveal, remainingSeconds: data.remainingSeconds as number | null };
}

// Formatting only: no device clock or countdown determines availability.
export function formatPublicRevealWindow(reveal: DailyRevealProgress): string {
  const format = (date: string) => new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(date));
  return `${format(reveal.publicWindowStart)}–${format(reveal.publicWindowEnd)} (한국 시간)`;
}

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
    const row = parseDailyReveal(item);
    if (row.dayIndex !== index + 1) throw invalidResponse();
    return row;
  });
  return { weekStart: data.weekStart, currentDayIndex: data.currentDayIndex as WeeklyDay | null,
    submissionStatus: data.submissionStatus as WeeklyProgress['submissionStatus'], submittedAt: data.submittedAt as string | null, reveals };
}
