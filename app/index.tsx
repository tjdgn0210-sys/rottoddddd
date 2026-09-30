import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppShell, buttonStyle, cardStyle, mutedStyle, textStyle } from '@/components/AppShell';
import { DEFAULT_CHARACTER } from '@/domain/characters';
import { getWeeklyCalendarContext } from '@/domain/weekly';
import { fetchCurrentWeeklyProgress, fetchUserProfile, type UserProfile, type WeeklyProgress } from '@/data/weeklyRepository';
import { getBackendConfigurationMessage } from '@/lib/supabase';

export default function HomeScreen() {
  const context = getWeeklyCalendarContext(new Date());
  const configurationMessage = getBackendConfigurationMessage();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progress, setProgress] = useState<WeeklyProgress | null>(null);
  const [message, setMessage] = useState<string | null>(configurationMessage);

  useEffect(() => {
    if (configurationMessage) return;
    let active = true;
    Promise.all([fetchUserProfile(), fetchCurrentWeeklyProgress()])
      .then(([nextProfile, nextProgress]) => {
        if (active) { setProfile(nextProfile); setProgress(nextProgress); setMessage(null); }
      })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : '주간 정보를 불러오지 못했습니다.'); });
    return () => { active = false; };
  }, [configurationMessage]);

  const todayReveal = progress?.reveals.find((reveal) => reveal.dayIndex === context.dayNumber);
  return (
    <AppShell title="이번 주의 기록">
      <View style={cardStyle}>
        <Text style={styles.day}>{context.dayNumber ? `DAY ${context.dayNumber} / 6` : 'SUNDAY · WAITING'}</Text>
        <Text style={textStyle}>주간 상태 · {progress?.submissionStatus ?? '기록 없음'}</Text>
        <Text style={mutedStyle}>오늘 공개 상태 · {todayReveal?.state ?? (context.isRevealDay ? '기록 없음' : '일요일 대기')}</Text>
        <Text style={mutedStyle}>오늘 공개 가능 여부 · 공개 요청 시 서버가 확인</Text>
        <Text style={mutedStyle}>다음 공개까지 · 시간표 연동 전</Text>
      </View>
      <View style={cardStyle}>
        <Text style={textStyle}>포인트 · {profile ? `${profile.pointBalance}P` : '—'}</Text>
        <Text style={mutedStyle}>현재 캐릭터 · {DEFAULT_CHARACTER.name} (기본)</Text>
      </View>
      {message && <View style={cardStyle}><Text style={mutedStyle}>{message}</Text></View>}
      <Link href="/reveal" asChild><Pressable style={buttonStyle}><Text style={styles.buttonText}>공개 화면 보기</Text></Pressable></Link>
    </AppShell>
  );
}

const styles = StyleSheet.create({ day: { color: '#9a7540', fontWeight: '700', letterSpacing: 1.2 }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' } });
