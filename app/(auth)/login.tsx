import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/components/AuthProvider';
import { buttonStyle, cardStyle, mutedStyle } from '@/components/AppShell';
import { validateAuthInput, type AuthMode } from '@/domain/auth';
import { getBackendConfigurationMessage } from '@/lib/supabase';

export default function LoginScreen() {
  const { signIn, signUp, error: restoreError, retryRestore } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const submitting = useRef(false);
  const passwordInput = useRef<TextInput>(null);
  const confirmInput = useRef<TextInput>(null);
  const configurationMessage = getBackendConfigurationMessage();

  const submit = async () => {
    if (submitting.current || configurationMessage) return;
    const validation = validateAuthInput(mode, email, password, confirmation);
    if (validation) { setMessage(validation); return; }
    submitting.current = true;
    setBusy(true); setMessage(null); setCheckEmail(false);
    try {
      if (mode === 'signIn') await signIn(email, password);
      else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setCheckEmail(true); setPassword(''); setConfirmation('');
          setMessage('이메일을 확인해 계정을 인증하세요. 인증 후 로그인할 수 있습니다.');
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '요청을 완료하지 못했습니다. 다시 시도하세요.');
    } finally { submitting.current = false; setBusy(false); }
  };

  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <Text style={styles.brand}>SIX DAYS</Text>
        <Text style={styles.title}>{mode === 'signIn' ? '다시 만나 반가워요' : '여섯 날의 기록 시작'}</Text>
        <Text style={mutedStyle}>이메일로 로그인하고 이번 주의 기록을 이어가세요.</Text>
        <View style={cardStyle}>
          <Text style={styles.label}>이메일</Text>
          <TextInput accessibilityLabel="이메일" style={styles.input} value={email} onChangeText={setEmail} editable={!busy}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
            placeholder="you@example.com" returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} />
          <Text style={styles.label}>비밀번호</Text>
          <TextInput ref={passwordInput} accessibilityLabel="비밀번호" style={styles.input} value={password} onChangeText={setPassword} editable={!busy}
            secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            textContentType={mode === 'signUp' ? 'newPassword' : 'password'} returnKeyType={mode === 'signUp' ? 'next' : 'done'}
            onSubmitEditing={() => mode === 'signUp' ? confirmInput.current?.focus() : void submit()} />
          {mode === 'signUp' && <>
            <Text style={styles.label}>비밀번호 확인</Text>
            <TextInput ref={confirmInput} accessibilityLabel="비밀번호 확인" style={styles.input} value={confirmation} onChangeText={setConfirmation}
              editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
              returnKeyType="done" onSubmitEditing={() => void submit()} />
          </>}
        </View>
        {(message || restoreError) && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={checkEmail ? mutedStyle : styles.error}>{message ?? restoreError}</Text>}
        {restoreError && !configurationMessage && <Pressable accessibilityRole="button" disabled={busy} onPress={retryRestore}><Text style={styles.link}>로그인 복원 다시 시도</Text></Pressable>}
        <Pressable accessibilityRole="button" disabled={busy || Boolean(configurationMessage)} onPress={() => void submit()}
          style={[buttonStyle, (busy || configurationMessage) && styles.disabled]}>
          <Text style={styles.buttonText}>{busy ? '처리 중…' : mode === 'signIn' ? '로그인' : '회원가입'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => {
          setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setMessage(null); setCheckEmail(false); setPassword(''); setConfirmation('');
        }}><Text style={styles.link}>{mode === 'signIn' ? '처음이신가요? 회원가입' : '이미 계정이 있나요? 로그인'}</Text></Pressable>
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f4f0' },
  page: { flexGrow: 1, justifyContent: 'center', padding: 22, paddingVertical: 48 },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 16 },
  brand: { color: '#6d7786', fontSize: 11, fontWeight: '700', letterSpacing: 2.4 },
  title: { color: '#171b24', fontSize: 28, fontWeight: '700' },
  label: { color: '#252b35', fontSize: 14, fontWeight: '600' },
  input: { backgroundColor: '#f5f4f0', borderRadius: 12, padding: 14, color: '#252b35', fontSize: 16, minHeight: 48 },
  error: { color: '#a33c32', fontSize: 14, lineHeight: 21 },
  link: { textAlign: 'center', color: '#303846', fontSize: 14, padding: 8 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
