import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publicKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
let client: SupabaseClient | null = null;

export function getBackendConfigurationMessage(): string | null {
  if (!url || !publicKey) {
    return 'Supabase 설정이 없습니다. .env의 EXPO_PUBLIC_SUPABASE_URL과 EXPO_PUBLIC_SUPABASE_ANON_KEY를 설정하세요.';
  }
  if (url.includes('your-project.supabase.co') || publicKey.startsWith('your-public-')) {
    return '.env.example의 예시 값을 실제 Supabase 프로젝트 URL과 공개 키로 바꿔 주세요.';
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
      return null;
    }
  } catch {
    // Report one clear configuration message below.
  }
  return 'EXPO_PUBLIC_SUPABASE_URL에 유효한 Supabase HTTPS 주소를 설정하세요.';
}

export function getSupabaseClient(): SupabaseClient {
  const configurationMessage = getBackendConfigurationMessage();
  if (configurationMessage) throw new Error(configurationMessage);
  if (!client) {
    client = createClient(url!, publicKey!, {
      auth: {
        storage: typeof localStorage === 'undefined' ? undefined : localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
