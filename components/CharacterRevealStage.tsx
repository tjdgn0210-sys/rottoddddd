import { StyleSheet, Text, View } from 'react-native';
import type { Character } from '@/domain/characters';

export interface CharacterRevealStageProps {
  character: Character;
  number?: number;
}

export function CharacterRevealStage({ character, number }: CharacterRevealStageProps) {
  return (
    <View style={styles.stage}>
      <Text style={styles.eyebrow}>{character.name.toUpperCase()} · REVEAL STAGE</Text>
      <View style={styles.orb}>
        <Text style={styles.number}>{number ?? '· · ·'}</Text>
      </View>
      <Text style={styles.caption}>{number === undefined ? '오늘의 숫자가 이곳에서 공개됩니다' : '오늘의 숫자'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center', minHeight: 300, borderRadius: 28, backgroundColor: '#171b24', padding: 28 },
  eyebrow: { color: '#a8b1c2', fontSize: 11, letterSpacing: 1.8 },
  orb: { width: 150, height: 150, borderRadius: 75, marginVertical: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#262e3b', borderWidth: 1, borderColor: '#515e74' },
  number: { color: '#f2d9a6', fontSize: 44, fontWeight: '600' },
  caption: { color: '#d1d6df', fontSize: 14 },
});
