import { Text, View } from 'react-native';
import { AppShell, cardStyle, mutedStyle } from '@/components/AppShell';

export default function SettingsScreen() {
  return <AppShell title="설정"><View style={cardStyle}><Text style={mutedStyle}>로그아웃은 홈 화면에서 할 수 있습니다. 추가 설정은 추후 연결됩니다.</Text></View></AppShell>;
}
