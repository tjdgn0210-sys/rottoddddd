import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppShell, buttonStyle, cardStyle, mutedStyle } from '@/components/AppShell';

export default function SubmissionScreen() {
  const [numbers, setNumbers] = useState(['', '', '', '', '', '']);
  const updateNumber = (index: number, value: string) => {
    setNumbers((current) => current.map((number, itemIndex) => itemIndex === index ? value.replace(/\D/g, '').slice(0, 2) : number));
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
            keyboardType="number-pad"
            maxLength={2}
            placeholder="—"
            style={styles.numberInput}
          />
        ))}
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={[buttonStyle, styles.disabled]}>
        <Text style={styles.buttonText}>여섯 번 공개 후 제출 가능</Text>
      </Pressable>
      <Text style={mutedStyle}>주간 답안 확인은 서버 연동 전입니다. 실패 결과에는 정답 조합을 포함하지 않도록 도메인 규칙이 준비되어 있습니다.</Text>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  numberRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  numberInput: { flex: 1, minWidth: 0, height: 54, borderRadius: 14, backgroundColor: '#fff', textAlign: 'center', color: '#252b35', fontSize: 20, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
