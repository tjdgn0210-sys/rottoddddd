import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppShell, buttonStyle, cardStyle, mutedStyle } from '@/components/AppShell';
import { CharacterRevealStage } from '@/components/CharacterRevealStage';
import { DEFAULT_CHARACTER } from '@/domain/characters';
import { consumeDailyReveal } from '@/data/weeklyRepository';
import { getBackendConfigurationMessage } from '@/lib/supabase';

export default function RevealScreen() {
  const configurationMessage = getBackendConfigurationMessage();
  const [number, setNumber] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [consumed, setConsumed] = useState(false);
  const [message, setMessage] = useState<string | null>(configurationMessage);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const reveal = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const revealedNumber = await consumeDailyReveal();
      setConsumed(true);
      if (revealedNumber === null) {
        setMessage('오늘의 공개 시간이 지났습니다.');
      } else {
        setNumber(revealedNumber);
        hideTimer.current = setTimeout(() => setNumber(undefined), 10_000);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '공개 요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="오늘의 공개">
      <CharacterRevealStage character={DEFAULT_CHARACTER} number={number} />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(configurationMessage) || consumed || busy }}
        disabled={Boolean(configurationMessage) || consumed || busy}
        onPress={reveal}
        style={[buttonStyle, (configurationMessage || consumed || busy) && styles.disabled]}>
        <Text style={styles.buttonText}>{busy ? '확인 중…' : consumed ? '오늘의 공개 완료' : '오늘의 숫자 공개'}</Text>
      </Pressable>
      <View style={cardStyle}>
        <Text style={mutedStyle}>{message ?? '서버가 공개 가능 시간과 사용 여부를 확인합니다. 공개된 숫자는 잠시 후 화면에서 사라집니다.'}</Text>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
