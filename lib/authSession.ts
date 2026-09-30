import type { Session, SupabaseClient } from '@supabase/supabase-js';

/** Auth callbacks stay synchronous. A late restore must never overwrite a newer auth event. */
export function observeSession(
  client: SupabaseClient,
  onSession: (session: Session | null) => void,
  onError: (error: unknown) => void,
): () => void {
  let active = true;
  let revision = 0;
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (!active || event === 'INITIAL_SESSION') return;
    revision += 1;
    onSession(session);
  });
  const initialRevision = revision;
  void (async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session) {
        const { error: userError } = await client.auth.getUser();
        if (userError) throw userError;
      }
      if (active && revision === initialRevision) onSession(data.session);
    } catch (error) {
      if (active && revision === initialRevision) onError(error);
    }
  })();
  return () => { active = false; subscription.unsubscribe(); };
}
