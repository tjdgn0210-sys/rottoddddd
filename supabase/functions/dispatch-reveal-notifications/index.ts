import { dispatchDuePushes } from './delivery.ts';

// JWT verification is disabled for this cron-only function. A dedicated secret,
// unavailable to normal users, is required by the handler on every request.
Deno.serve(async (request: Request) => {
  const secret = Deno.env.get('REVEAL_DISPATCH_SECRET');
  if (!secret || secret.length < 32) return Response.json({ error: 'Dispatcher configuration required' }, { status: 503 });
  const supplied = request.headers.get('x-reveal-dispatch-secret') ?? '';
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [expected, actual] = await Promise.all([digest(secret), digest(supplied)]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i];
  if (difference !== 0) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return Response.json({ error: 'Backend configuration required' }, { status: 503 });
  async function rpc<T>(name: string, args = {}): Promise<T> {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST',
      headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Trusted database operation failed');
    return response.status === 204 ? undefined as T : await response.json();
  }
  try {
    // Receipt failures never cause a resend. Expo recommends checking after 15m.
    const receipts = await rpc<{ delivery_id: string; ticket: string }[]>('pending_reveal_push_receipts');
    let checked = 0;
    try { if (receipts.length) {
      const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {}) },
        body: JSON.stringify({ ids: receipts.map((r) => r.ticket) }), signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const body = await response.json();
        for (const receipt of receipts) {
          const result = body.data?.[receipt.ticket];
          if (result?.status !== 'ok' && result?.status !== 'error') continue;
          await rpc('finish_reveal_push_receipt', { p_id: receipt.delivery_id,
            p_error: result.status === 'error' ? result.details?.error ?? 'ExpoReceiptError' : null });
          checked++;
        }
      }
    } } catch { /* Receipt retries must not block new due notifications. */ }
    const summary = await dispatchDuePushes({
      claim: () => rpc('claim_due_reveal_pushes'),
      prepare: (id) => rpc('prepare_reveal_push', { p_id: id }),
      finish: (id, result) => rpc('finish_reveal_push', { p_id: id, p_outcome: result.outcome, p_ticket: result.ticket, p_error: result.error }),
    }, fetch, Deno.env.get('EXPO_ACCESS_TOKEN'));
    return Response.json({ ...summary, receiptsChecked: checked });
  } catch {
    // Never log tokens, schedules, request secrets, or provider response bodies.
    return Response.json({ error: 'Dispatch operation failed' }, { status: 502 });
  }
});
