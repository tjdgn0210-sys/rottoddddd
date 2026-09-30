export const REVEAL_STATES = [
  'WAITING',
  'AVAILABLE',
  'REVEAL_READY',
  'CONSUMED',
  'LOCKED',
  'EXPIRED',
] as const;

export type RevealState = (typeof REVEAL_STATES)[number];
export type WeeklyNumbers = readonly [number, number, number, number, number, number];
export type WeeklyDay = 1 | 2 | 3 | 4 | 5 | 6;

export interface WeeklyCycle {
  weekStartsOn: string;
  numbers: WeeklyNumbers;
}

const transitions: Record<RevealState, readonly RevealState[]> = {
  WAITING: ['AVAILABLE'],
  AVAILABLE: ['REVEAL_READY', 'EXPIRED'],
  REVEAL_READY: ['CONSUMED'],
  CONSUMED: ['LOCKED'],
  LOCKED: [],
  EXPIRED: [],
};

export function canTransitionRevealState(from: RevealState, to: RevealState): boolean {
  return transitions[from].includes(to);
}

export function generateWeeklyNumbers(random: () => number): WeeklyNumbers {
  const pool = Array.from({ length: 45 }, (_, index) => index + 1);
  for (let index = 0; index < 6; index += 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('Random source must return a number in [0, 1).');
    }
    const swapIndex = index + Math.floor(sample * (pool.length - index));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, 6) as unknown as WeeklyNumbers;
}

export interface WeeklyCalendarContext {
  day: WeeklyDay | null;
  dayNumber: number | null;
  weekStartsOn: string;
  isRevealDay: boolean;
}

export function getWeeklyCalendarContext(date: Date): WeeklyCalendarContext {
  // Match the backend's Asia/Seoul weekly boundary for display and queries.
  const seoulDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const dayNumber = seoulDate.getUTCDay() === 0 ? 7 : seoulDate.getUTCDay();
  const monday = new Date(Date.UTC(seoulDate.getUTCFullYear(), seoulDate.getUTCMonth(), seoulDate.getUTCDate() - dayNumber + 1));
  return {
    day: dayNumber <= 6 ? (dayNumber as WeeklyDay) : null,
    dayNumber: dayNumber <= 6 ? dayNumber : null,
    weekStartsOn: `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`,
    isRevealDay: dayNumber <= 6,
  };
}

export type SubmissionOutcome = 'SUCCESS' | 'FAILURE';
export type SubmissionRejection = 'NOT_READY' | 'ALREADY_SUBMITTED' | 'WRONG_COUNT' | 'NOT_INTEGER' | 'OUT_OF_RANGE' | 'DUPLICATES';

export type WeeklySubmission =
  | { accepted: false; reason: SubmissionRejection }
  | { accepted: true; attemptUsed: true; outcome: SubmissionOutcome };

export function validateWeeklySubmissionInput(enteredNumbers: readonly number[]): SubmissionRejection | null {
  if (enteredNumbers.length !== 6) return 'WRONG_COUNT';
  if (!enteredNumbers.every(Number.isInteger)) return 'NOT_INTEGER';
  if (!enteredNumbers.every((number) => number >= 1 && number <= 45)) return 'OUT_OF_RANGE';
  if (new Set(enteredNumbers).size !== 6) return 'DUPLICATES';
  return null;
}

export function submitWeeklyNumbers(
  correctNumbers: WeeklyNumbers,
  enteredNumbers: readonly number[],
  allSixRevealsConsumed: boolean,
  alreadySubmitted: boolean,
): WeeklySubmission {
  if (alreadySubmitted) return { accepted: false, reason: 'ALREADY_SUBMITTED' };
  if (!allSixRevealsConsumed) return { accepted: false, reason: 'NOT_READY' };
  const invalidReason = validateWeeklySubmissionInput(enteredNumbers);
  if (invalidReason) return { accepted: false, reason: invalidReason };

  const expected = new Set(correctNumbers);
  const outcome = enteredNumbers.every((number) => expected.has(number)) ? 'SUCCESS' : 'FAILURE';
  return { accepted: true, attemptUsed: true, outcome };
}
