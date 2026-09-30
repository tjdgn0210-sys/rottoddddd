import type { SubmissionOutcome, RevealState } from '@/domain/weekly';
import { getWeeklyCalendarContext } from '@/domain/weekly';
import { getSupabaseClient } from '@/lib/supabase';

export interface UserProfile {
  pointBalance: number;
  currentSuccessStreak: number;
  totalSuccessfulWeeks: number;
}

export interface DailyRevealProgress {
  dayIndex: number;
  state: RevealState;
  availableAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface WeeklyProgress {
  weekStart: string;
  submissionStatus: 'PENDING' | SubmissionOutcome;
  submittedAt: string | null;
  reveals: DailyRevealProgress[];
}

export interface FinalSubmissionResult {
  outcome: SubmissionOutcome;
  pointsAwarded: number;
  currentSuccessStreak: number;
  pointBalance: number;
}

async function authenticatedClient() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error('로그인 상태를 확인하지 못했습니다. 다시 로그인하세요.');
  if (!data.session) throw new Error('로그인이 필요합니다. 다시 로그인하세요.');
  return client;
}

export async function fetchUserProfile(): Promise<UserProfile> {
  const client = await authenticatedClient();
  const { data, error } = await client.from('user_profiles')
    .select('point_balance,current_success_streak,total_successful_weeks').maybeSingle();
  if (error) throw new Error('계정 정보를 불러오지 못했습니다. 인터넷 연결과 서버 설정을 확인하고 다시 시도하세요.');
  if (!data) throw new Error('계정 프로필이 없습니다. 관리자에게 계정 초기화 상태를 확인해 주세요.');
  return {
    pointBalance: data.point_balance,
    currentSuccessStreak: data.current_success_streak,
    totalSuccessfulWeeks: data.total_successful_weeks,
  };
}

export async function fetchCurrentWeeklyProgress(): Promise<WeeklyProgress | null> {
  const client = await authenticatedClient();
  const weekStart = getWeeklyCalendarContext(new Date()).weekStartsOn;
  const { data: cycle, error: cycleError } = await client.from('weekly_cycles')
    .select('week_start,submission_status,submitted_at').eq('week_start', weekStart).maybeSingle();
  if (cycleError) throw new Error('주간 기록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
  if (!cycle) return null;

  const { data: reveals, error: revealsError } = await client.from('daily_reveals')
    .select('day_index,state,available_at,expires_at,consumed_at')
    .eq('week_start', weekStart).order('day_index');
  if (revealsError) throw new Error('공개 기록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
  return {
    weekStart: cycle.week_start,
    submissionStatus: cycle.submission_status,
    submittedAt: cycle.submitted_at,
    reveals: (reveals ?? []).map((reveal) => ({
      dayIndex: reveal.day_index,
      state: reveal.state,
      availableAt: reveal.available_at,
      expiresAt: reveal.expires_at,
      consumedAt: reveal.consumed_at,
    })),
  };
}

export async function consumeDailyReveal(): Promise<number | null> {
  const client = await authenticatedClient();
  const { data, error } = await client.rpc('consume_daily_reveal');
  if (error) throw new Error('공개할 수 없습니다. 공개 시간과 사용 여부를 확인하거나 잠시 후 다시 시도하세요.');
  if (data === null) return null; // The window expired without returning a number.
  if (typeof data !== 'number' || !Number.isInteger(data) || data < 1 || data > 45) {
    throw new Error('공개 응답이 올바르지 않습니다.');
  }
  return data;
}

export async function submitWeeklyNumbers(numbers: readonly number[]): Promise<FinalSubmissionResult> {
  const client = await authenticatedClient();
  const { data, error } = await client.rpc('submit_weekly_numbers', { p_numbers: [...numbers] });
  if (error) throw new Error('제출할 수 없습니다. 제출 가능 시간과 여섯 번의 공개 완료 여부를 확인하세요.');
  if (!data || (data.outcome !== 'SUCCESS' && data.outcome !== 'FAILURE')) {
    throw new Error('제출 응답이 올바르지 않습니다.');
  }
  return {
    outcome: data.outcome,
    pointsAwarded: data.pointsAwarded,
    currentSuccessStreak: data.currentSuccessStreak,
    pointBalance: data.pointBalance,
  };
}
