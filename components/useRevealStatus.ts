import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/components/AuthProvider';
import { fetchCurrentRevealStatus } from '@/data/weeklyRepository';
import { getBackendConfigurationMessage } from '@/lib/supabase';
import type { CurrentRevealStatus } from '@/domain/weeklyProgress';

export function useRevealStatus() {
  const { user } = useAuth();
  const [status, setStatus] = useState<CurrentRevealStatus | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useFocusEffect(useCallback(() => {
    let active = true;
    let pending = false;
    setStatus(null); setLoading(true); setError(null);
    const refresh = async () => {
      if (pending || !active) return;
      const configurationMessage = getBackendConfigurationMessage();
      if (configurationMessage) { setError(configurationMessage); setLoading(false); return; }
      pending = true;
      try {
        const nextStatus = await fetchCurrentRevealStatus();
        if (active) { setStatus(nextStatus); setError(null); }
      } catch {
        // Disable the action if current server state cannot be verified.
        if (active) { setStatus(null); setError('공개 상태를 확인하지 못했습니다. 다시 시도하세요.'); }
      } finally { pending = false; if (active) setLoading(false); }
    };
    refreshRef.current = refresh;
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 15_000);
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { active = false; clearInterval(timer); appState.remove(); refreshRef.current = async () => {}; };
  }, [user?.id]));
  return { status, isLoading, error, refresh: () => refreshRef.current() };
}
