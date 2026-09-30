import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppShell, buttonStyle, cardStyle, mutedStyle } from '@/components/AppShell';
import { fetchCurrentWeeklyProgress, submitWeeklyNumbers, type FinalSubmissionResult } from '@/data/weeklyRepository';
import { validateWeeklySubmissionInput } from '@/domain/weekly';
import { getBackendConfigurationMessage } from '@/lib/supabase';

export default function SubmissionScreen() {
  const configurationMessage = getBackendConfigurationMessage();
  const [numbers, setNumbers] = useState(['', '', '', '', '', '']);
  const [ready, setReady] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FinalSubmissionResult | null>(null);
  const [message, setMessage] = useState<string | null>(configurationMessage);

  useEffect(() => {
    if (configurationMessage) return;
    let active = true;
    fetchCurrentWeeklyProgress().then((progress) => {
      if (!active) return;
      setSubmitted(Boolean(progress && progress.submissionStatus !== 'PENDING'));
      setReady(Boolean(progress && progress.submissionStatus === 'PENDING'
        && progress.reveals.length === 6 && progress.reveals.every((reveal) => reveal.state === 'LOCKED')));
      setMessage(progress ? null : '이번 주 기록이 아직 없습니다.');
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : '주간 정보를 불러오지 못했습니다.');
    });
    return () => { active = false; };
  }, [configurationMessage]);

  const updateNumber = (index: number, value: string) => {
    setNumbers((current) => current.map((number, itemIndex) => itemIndex === index ? value.replace(/\D/g, '').slice(0, 2) : number));
  };

  const submit = async () => {
    if (numbers.some((number) => number === '')) {
      setMessage('숫자 여섯 개를 모두 입력하세요.');
      return;
    }
    const enteredNumbers = numbers.map(Number);
    if (validateWeeklySubmissionInput(enteredNumbers)) {
      setMessage('1~45의 서로 다른 정수 여섯 개를 입력하세요.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const nextResult = await submitWeeklyNumbers(enteredNumbers);
      setResult(nextResult);
      setSubmitted(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '제출 요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="주간 제출">
      <View style={cardStyle}>
        <Text style={mutedStyle}>토요일 여섯 번째 공개를 마친 뒤 숫자 여섯 개를 한 번 제출하는 흐름을 위한 화면입니다.</Text>
      </View>
      <View style={styles.numberRow}>
        {numbers.map((number, index) => (
          <TextInput
            key={index}
            accessibilityLabel={`숫자 ${index + 1}`}
            value={number}
            onChangeText={(value) => updateNumber(index, value)}
            editable={ready && !submitted && !busy}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="—"
            style={styles.numberInput}
          />
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready || submitted || busy }}
        disabled={!ready || submitted || busy}
        onPress={submit}
        style={[buttonStyle, (!ready || submitted || busy) && styles.disabled]}>
        <Text style={styles.buttonText}>{submitted ? '이번 주 제출 완료' : busy ? '제출 중…' : ready ? '최종 제출' : '여섯 번 공개 후 제출 가능'}</Text>
      </Pressable>
      {result && <View style={cardStyle}><Text style={mutedStyle}>{result.outcome === 'SUCCESS' ? `성공 · ${result.pointsAwarded}P 획득` : '실패 · 이번 주 제출이 완료되었습니다.'}</Text></View>}
      <Text style={mutedStyle}>{message ?? '한 번 제출하면 수정할 수 없습니다. 결과는 서버에서 확인합니다.'}</Text>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  numberRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  numberInput: { flex: 1, minWidth: 0, height: 54, borderRadius: 14, backgroundColor: '#fff', textAlign: 'center', color: '#252b35', fontSize: 20, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
