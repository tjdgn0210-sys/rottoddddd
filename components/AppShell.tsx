import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';

const links = [
  ['/', '홈'], ['/reveal', '숫자 공개'], ['/submission', '주간 제출'], ['/shop', '상점'], ['/collection', '컬렉션'], ['/settings', '설정'],
] as const;

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.content}>
        <Text style={styles.brand}>SIX DAYS</Text>
        <Text style={styles.title}>{title}</Text>
        {children}
        <View style={styles.nav}>
          {links.map(([href, label]) => (
            <Link key={href} href={href} asChild>
              <Pressable style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}><Text style={styles.navText}>{label}</Text></Pressable>
            </Link>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: '#f5f4f0', padding: 22, paddingTop: 42 },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 16 },
  brand: { color: '#6d7786', fontSize: 11, fontWeight: '700', letterSpacing: 2.4 },
  title: { color: '#171b24', fontSize: 30, fontWeight: '700', marginBottom: 4 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 18, gap: 8 },
  body: { color: '#252b35', fontSize: 16, lineHeight: 24 },
  muted: { color: '#6d7786', fontSize: 14, lineHeight: 21 },
  button: { alignItems: 'center', borderRadius: 14, backgroundColor: '#252d3b', paddingVertical: 15, paddingHorizontal: 18 },
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 12, paddingBottom: 20 },
  navItem: { backgroundColor: '#e8e7e1', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 999 },
  navText: { color: '#303846', fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});

export const cardStyle = styles.card;
export const textStyle = styles.body;
export const mutedStyle = styles.muted;
export const buttonStyle = styles.button;
