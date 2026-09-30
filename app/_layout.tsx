import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '@/components/AuthProvider';
import { NotificationObserver } from '@/components/NotificationObserver';

function AuthenticatedNavigator() {
  const { session, isLoading } = useAuth();
  if (isLoading) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#f5f4f0' }}><ActivityIndicator accessibilityLabel="로그인 복원 중" /></View>;
  return <Stack key={session?.user.id ?? 'signed-out'} screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={Boolean(session)}><Stack.Screen name="(app)" /></Stack.Protected>
    <Stack.Protected guard={!session}><Stack.Screen name="(auth)" /></Stack.Protected>
  </Stack>;
}

export default function RootLayout() {
  return <AuthProvider><AuthenticatedNavigator /><NotificationObserver /></AuthProvider>;
}
