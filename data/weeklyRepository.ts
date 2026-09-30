import type { SubmissionOutcome } from '@/domain/weekly';
import { parseWeeklyProgress, parseCurrentRevealStatus, type CurrentRevealStatus, type WeeklyProgress } from '@/domain/weeklyProgress';
export type { DailyRevealProgress, WeeklyProgress } from '@/domain/weeklyProgress';
import { getSupabaseClient } from '@/lib/supabase';

export interface UserProfile {
  pointBalance: number;
  currentSuccessStreak: number;
  totalSuccessfulWeeks: number;
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

export async function ensureCurrentWeek(): Promise<WeeklyProgress> {
  const client = await authenticatedClient();
  const { data, error } = await client.rpc('ensure_current_week');
  if (error) throw new Error('주간 기록을 준비하지 못했습니다. 인터넷 연결과 서버 설정을 확인하고 다시 시도하세요.');
  return parseWeeklyProgress(data);
}

// Existing Home and Submission callers now receive server-selected current state.
export async function fetchCurrentWeeklyProgress(): Promise<WeeklyProgress> {
  return ensureCurrentWeek();
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

export async function fetchCurrentRevealStatus(): Promise<CurrentRevealStatus> {
  const client = await authenticatedClient();
  const { data, error } = await client.rpc('get_current_reveal_status');
  if (error) throw new Error('공개 상태를 확인하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.');
  return parseCurrentRevealStatus(data);
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
