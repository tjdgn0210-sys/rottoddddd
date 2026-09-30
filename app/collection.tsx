import { Text, View } from 'react-native';
import { AppShell, cardStyle, mutedStyle } from '@/components/AppShell';

export default function CollectionScreen() {
  return <AppShell title="컬렉션"><View style={cardStyle}><Text style={mutedStyle}>모은 캐릭터와 스킨을 이곳에서 확인합니다.</Text></View></AppShell>;
}
