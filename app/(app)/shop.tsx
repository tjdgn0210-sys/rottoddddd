import { Text, View } from 'react-native';
import { AppShell, cardStyle, mutedStyle } from '@/components/AppShell';

export default function ShopScreen() {
  return <AppShell title="상점"><View style={cardStyle}><Text style={mutedStyle}>캐릭터 상점은 준비 중입니다.</Text></View></AppShell>;
}
