import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppShell, buttonStyle, cardStyle, mutedStyle, textStyle } from '@/components/AppShell';
import { DEFAULT_CHARACTER } from '@/domain/characters';
import { fetchCurrentWeeklyProgress, fetchUserProfile, type UserProfile, type WeeklyProgress } from '@/data/weeklyRepository';
import { getBackendConfigurationMessage } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { useRevealStatus } from '@/components/useRevealStatus';
import { formatPublicRevealWindow } from '@/domain/weeklyProgress';

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const revealStatus = useRevealStatus();
  const configurationMessage = getBackendConfigurationMessage();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progress, setProgress] = useState<WeeklyProgress | null>(null);
  const [message, setMessage] = useState<string | null>(configurationMessage);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [weeklyLoading, setWeeklyLoading] = useState(true);

  useEffect(() => {
    if (configurationMessage) return;
    let active = true;
    setProfile(null); setProfileLoading(true); setProfileMessage(null);
    setProgress(null); setWeeklyLoading(true); setMessage(null);
    fetchUserProfile().then((nextProfile) => { if (active) setProfile(nextProfile); })
      .catch((error: unknown) => { if (active) setProfileMessage(error instanceof Error ? error.message : '계정 정보를 불러오지 못했습니다.'); })
      .finally(() => { if (active) setProfileLoading(false); });
    fetchCurrentWeeklyProgress().then((nextProgress) => {
      if (active) { setProgress(nextProgress); setMessage(null); }
    }).catch(() => { if (active) setMessage('주간 정보를 준비하지 못했습니다. 인터넷 연결과 서버 설정을 확인하고 다시 시도하세요.'); })
      .finally(() => { if (active) setWeeklyLoading(false); });
    return () => { active = false; };
  }, [configurationMessage, user?.id, attempt]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { await signOut(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '로그아웃하지 못했습니다. 다시 시도하세요.'); }
    finally { setSigningOut(false); }
  };

  const todayReveal = revealStatus.status?.reveal;
  return (
    <AppShell title="이번 주의 기록">
      <View style={cardStyle}>
        <Text style={styles.day}>{revealStatus.status ? (revealStatus.status.currentDayIndex ? `DAY ${revealStatus.status.currentDayIndex} / 6` : 'SUNDAY · WAITING') : weeklyLoading ? '주간 기록 준비 중…' : '주간 기록 확인 필요'}</Text>
        {progress && <Text style={mutedStyle}>이번 주 · {progress.weekStart} 시작</Text>}
        <Text style={textStyle}>주간 상태 · {progress?.submissionStatus ?? '기록 없음'}</Text>
        <Text style={mutedStyle}>오늘 공개 상태 · {todayReveal?.state ?? (revealStatus.status?.currentDayIndex === null ? '일요일 대기' : '확인 중')}</Text>
        {todayReveal && <Text style={mutedStyle}>오늘의 공개 범위 · {formatPublicRevealWindow(todayReveal)}</Text>}
        <Text style={mutedStyle}>공개가 시작되면 5분 동안 한 번 확인할 수 있습니다.</Text>
        {revealStatus.error && <Text style={mutedStyle}>{revealStatus.error}</Text>}
        <Pressable accessibilityRole="button" onPress={() => void revealStatus.refresh()}><Text style={mutedStyle}>공개 상태 새로고침</Text></Pressable>
      </View>
      <View style={cardStyle}>
        <Text style={mutedStyle}>{user?.email}</Text>
        <Text style={textStyle}>포인트 · {profile ? `${profile.pointBalance}P` : '—'}</Text>
        <Text style={mutedStyle}>연속 성공 · {profile ? `${profile.currentSuccessStreak}주` : '—'}</Text>
        {profileLoading && <Text style={mutedStyle}>계정 정보 불러오는 중…</Text>}
        {profileMessage && <>
          <Text accessibilityRole="alert" style={mutedStyle}>{profileMessage}</Text>
          <Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)}><Text style={textStyle}>다시 시도</Text></Pressable>
        </>}
        <Text style={mutedStyle}>현재 캐릭터 · {DEFAULT_CHARACTER.name} (기본)</Text>
        <Pressable accessibilityRole="button" disabled={signingOut} onPress={() => void handleSignOut()}><Text style={textStyle}>{signingOut ? '로그아웃 중…' : '로그아웃'}</Text></Pressable>
      </View>
      {message && <View style={cardStyle}><Text style={mutedStyle}>{message}</Text><Pressable accessibilityRole="button" disabled={weeklyLoading} onPress={() => setAttempt((value) => value + 1)}><Text style={textStyle}>다시 시도</Text></Pressable></View>}
      <Link href="/reveal" asChild><Pressable style={buttonStyle}><Text style={styles.buttonText}>공개 화면 보기</Text></Pressable></Link>
    </AppShell>
  );
}

const styles = StyleSheet.create({ day: { color: '#9a7540', fontWeight: '700', letterSpacing: 1.2 }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' } });
