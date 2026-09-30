import { getSupabaseClient } from '@/lib/supabase';
import { getAuthErrorMessage } from '@/domain/auth';

async function authRequest<T>(request: () => Promise<T>): Promise<T> {
  try { return await request(); }
  catch (error) { throw new Error(getAuthErrorMessage(error)); }
}

export async function signUpWithPassword(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  return authRequest(async () => {
    const { data, error } = await getSupabaseClient().auth.signUp({ email: email.trim(), password });
    if (error) throw error;
    // Supabase may intentionally obscure duplicate accounts. Keep the confirmation response neutral.
    return { needsConfirmation: !data.session };
  });
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  return authRequest(async () => {
    const { error } = await getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  });
}

export async function signOutSession(): Promise<void> {
  return authRequest(async () => {
    const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
    if (error) throw error;
  });
}
