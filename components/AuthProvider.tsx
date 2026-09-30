import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import { signInWithPassword, signOutSession, signUpWithPassword } from '@/data/authRepository';
import { getBackendConfigurationMessage, getSupabaseClient } from '@/lib/supabase';
import { observeSession } from '@/lib/authSession';
import { getAuthErrorMessage } from '@/domain/auth';
import { disablePushRegistration } from '@/lib/pushRegistration';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  error: string | null;
  retryRestore: () => void;
  signUp: typeof signUpWithPassword;
  signIn: typeof signInWithPassword;
  signOut: typeof signOutSession;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const configurationMessage = getBackendConfigurationMessage();
    if (configurationMessage) { setError(configurationMessage); setLoading(false); return; }
    const client = getSupabaseClient();
    const stopObserving = observeSession(client, (nextSession) => {
      setSession(nextSession); setError(null); setLoading(false);
    }, (restoreError) => {
      setSession(null); setError(getAuthErrorMessage(restoreError)); setLoading(false);
    });
    const updateRefresh = (state: string) => {
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    };
    const appStateSubscription = Platform.OS !== 'web' ? AppState.addEventListener('change', updateRefresh) : null;
    if (Platform.OS !== 'web') updateRefresh(AppState.currentState);
    return () => {
      stopObserving();
      appStateSubscription?.remove();
      if (Platform.OS !== 'web') client.auth.stopAutoRefresh();
    };
  }, [attempt]);

  return <AuthContext.Provider value={{ user: session?.user ?? null, session, isLoading, error,
    retryRestore: () => setAttempt((value) => value + 1),
    signUp: signUpWithPassword, signIn: signInWithPassword, signOut: async () => {
      if (session?.user) {
        // A network failure must not block explicit sign-out. Local retry intent
        // survives and is reconciled on the next authenticated session.
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([disablePushRegistration(session.user.id).catch(() => {}),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, 5000); })]);
        if (timer) clearTimeout(timer);
      }
      await signOutSession();
    } }}>
    {children}
  </AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
