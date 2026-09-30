import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppShell, buttonStyle, cardStyle, mutedStyle, textStyle } from '@/components/AppShell';
import { DEFAULT_CHARACTER, type PointBalance } from '@/domain/characters';
import { getWeeklyCalendarContext } from '@/domain/weekly';

const balance: PointBalance = { available: 0, lifetimeEarned: 0 };

export default function HomeScreen() {
  const context = getWeeklyCalendarContext(new Date());
  const revealState = context.isRevealDay ? 'AVAILABLE' : 'WAITING';
  return (
    <AppShell title="이번 주의 기록">
      <View style={cardStyle}>
        <Text style={styles.day}>{context.dayNumber ? `DAY ${context.dayNumber} / 6` : 'SUNDAY · WAITING'}</Text>
        <Text style={textStyle}>현재 상태 · {revealState}</Text>
        <Text style={mutedStyle}>{context.isRevealDay ? '오늘의 공개 가능 여부: 개발용으로 가능 상태' : '일요일은 다음 주기를 기다리는 날입니다.'}</Text>
        <Text style={mutedStyle}>다음 공개까지 · 시간표 연동 전</Text>
      </View>
      <View style={cardStyle}>
        <Text style={textStyle}>포인트 · {balance.available}P</Text>
        <Text style={mutedStyle}>현재 캐릭터 · {DEFAULT_CHARACTER.name} (기본)</Text>
      </View>
      <Link href="/reveal" asChild><Pressable style={buttonStyle}><Text style={styles.buttonText}>공개 화면 보기</Text></Pressable></Link>
    </AppShell>
  );
}

const styles = StyleSheet.create({ day: { color: '#9a7540', fontWeight: '700', letterSpacing: 1.2 }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' } });
