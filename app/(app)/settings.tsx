import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AppShell, buttonStyle, cardStyle, mutedStyle, textStyle } from '@/components/AppShell';
import { useAuth } from '@/components/AuthProvider';
import { notificationSupport } from '@/lib/notifications';
import { disablePushRegistration, enablePushRegistration, pushRegistrationStatus } from '@/lib/pushRegistration';
import type { NotificationState } from '@/domain/notifications';

export default function SettingsScreen() {
  const { user } = useAuth();
  const [state, setState] = useState<NotificationState>('Disabled');
  const [message, setMessage] = useState(notificationSupport().message);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (user) void pushRegistrationStatus(user.id).then((next) => { if (active) setState(next); })
      .catch(() => { if (active) setMessage('서버 알림 상태를 확인하지 못했습니다. 등록 새로고침을 시도하세요.'); });
    return () => { active = false; };
  }, [user?.id]));
  const update = async (enable: boolean) => {
    if (!user || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      if (enable) await enablePushRegistration(user.id);
      else await disablePushRegistration(user.id);
      setState(enable ? 'Enabled' : 'Disabled');
      setMessage(enable ? '이 기기에 숫자 공개 알림이 등록되었습니다.' : '이 기기의 알림이 꺼졌습니다.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : '알림 설정을 저장하지 못했습니다.';
      if (detail === 'Permission denied') setState('Permission denied');
      else setState(notificationSupport().state);
      setMessage(detail === 'Permission denied' ? '알림 권한이 거부되었습니다. 기기 설정에서 허용할 수 있습니다.' : detail);
    } finally { pending.current = false; setBusy(false); }
  };
  const supported = !['Unsupported in this environment', 'Configuration required'].includes(notificationSupport().state);
  return <AppShell title="설정"><View style={cardStyle}>
    <Text style={textStyle}>Notifications: {state}</Text><Text style={mutedStyle}>{message}</Text>
    <Pressable accessibilityRole="button" disabled={busy || !supported} style={[buttonStyle, (busy || !supported) && { opacity: 0.5 }]} onPress={() => void update(true)}>
      <Text style={{ color: '#fff' }}>{state === 'Enabled' ? '등록 새로고침' : '알림 켜기'}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={busy || !supported} onPress={() => void update(false)}><Text style={textStyle}>알림 끄기</Text></Pressable>
    <Text style={mutedStyle}>공개 알림을 눌러도 숫자는 자동으로 소비되지 않습니다. 공개 가능 여부는 서버에서 확인합니다.</Text>
  </View><View style={cardStyle}><Text style={mutedStyle}>로그아웃은 홈 화면에서 할 수 있습니다.</Text></View></AppShell>;
}
