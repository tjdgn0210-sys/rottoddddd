import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppShell, buttonStyle, cardStyle, mutedStyle } from '@/components/AppShell';
import { CharacterRevealStage } from '@/components/CharacterRevealStage';
import { DEFAULT_CHARACTER } from '@/domain/characters';
import { consumeDailyReveal } from '@/data/weeklyRepository';
import { getBackendConfigurationMessage } from '@/lib/supabase';
import { useRevealStatus } from '@/components/useRevealStatus';
import { formatPublicRevealWindow } from '@/domain/weeklyProgress';

export default function RevealScreen() {
  const configurationMessage = getBackendConfigurationMessage();
  const revealStatus = useRevealStatus();
  const [number, setNumber] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [consumed, setConsumed] = useState(false);
  const [message, setMessage] = useState<string | null>(configurationMessage);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitting = useRef(false);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  useEffect(() => {
    setConsumed(false); setNumber(undefined);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, [revealStatus.status?.weekStart, revealStatus.status?.currentDayIndex]);

  const state = revealStatus.status?.reveal?.state;
  const disabled = Boolean(configurationMessage) || consumed || busy || state !== 'AVAILABLE';
  const label = consumed || state === 'LOCKED' ? '오늘의 공개 완료 · 다시 볼 수 없음'
    : state === 'EXPIRED' ? '오늘의 공개를 놓쳤습니다'
    : state === 'WAITING' ? '공개 시작을 기다리는 중'
    : revealStatus.status?.currentDayIndex === null ? '일요일에는 공개가 없습니다'
    : state === 'AVAILABLE' ? '오늘의 숫자 공개' : '공개 상태 확인 중';

  const reveal = async () => {
    if (disabled || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const revealedNumber = await consumeDailyReveal();
      if (revealedNumber === null) {
        setMessage('오늘의 공개 시간이 지났습니다.');
      } else {
        setConsumed(true);
        setNumber(revealedNumber);
        hideTimer.current = setTimeout(() => setNumber(undefined), 10_000);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '공개 요청에 실패했습니다.');
    } finally {
      submitting.current = false;
      setBusy(false);
      void revealStatus.refresh();
    }
  };

  return (
    <AppShell title="오늘의 공개">
      <CharacterRevealStage character={DEFAULT_CHARACTER} number={number} />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={reveal}
        style={[buttonStyle, disabled && styles.disabled]}>
        <Text style={styles.buttonText}>{busy ? '확인 중…' : label}</Text>
      </Pressable>
      <View style={cardStyle}>
        {revealStatus.status?.reveal && <Text style={mutedStyle}>공개 범위 · {formatPublicRevealWindow(revealStatus.status.reveal)}</Text>}
        <Text style={mutedStyle}>{message ?? revealStatus.error ?? '서버가 5분의 공개 시간과 사용 여부를 확인합니다. 공개된 숫자는 잠시 후 화면에서 사라집니다.'}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void revealStatus.refresh()}><Text style={mutedStyle}>상태 다시 확인</Text></Pressable>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
