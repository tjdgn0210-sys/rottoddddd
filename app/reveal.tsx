import { Text, View } from 'react-native';
import { AppShell, cardStyle, mutedStyle } from '@/components/AppShell';
import { CharacterRevealStage } from '@/components/CharacterRevealStage';
import { DEFAULT_CHARACTER } from '@/domain/characters';

export default function RevealScreen() {
  return (
    <AppShell title="오늘의 공개">
      <CharacterRevealStage character={DEFAULT_CHARACTER} />
      <View style={cardStyle}>
        <Text style={mutedStyle}>공개 연출의 기본 구조입니다. 캐릭터별 연출은 CharacterRevealStage 경계에서 교체할 수 있습니다.</Text>
      </View>
    </AppShell>
  );
}
