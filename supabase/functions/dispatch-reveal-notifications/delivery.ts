export type PreparedPush = { token: string; ttl_seconds: number };
export type PushResult = { outcome: 'SENT' | 'RETRY' | 'FAILED' | 'UNKNOWN'; ticket: string | null; error: string | null };
const permanent = new Set(['DeviceNotRegistered', 'MessageTooBig', 'InvalidCredentials', 'MismatchSenderId']);
export function buildRevealPush(push: PreparedPush) {
  return { to: push.token, title: "Today's number has arrived", body: 'You have 5 minutes to check it.',
    data: { type: 'DAILY_REVEAL' }, channelId: 'daily-reveal', ttl: push.ttl_seconds };
}
export async function sendRevealPush(push: PreparedPush, fetcher: typeof fetch = fetch, accessToken?: string): Promise<PushResult> {
  try {
    const response = await fetcher('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(buildRevealPush(push)), signal: AbortSignal.timeout(10_000),
    });
    // Only explicit rate rejection guarantees no acceptance. 5xx/network errors
    // can happen after acceptance, so do not retry those ambiguous requests.
    if (response.status === 429) return { outcome: 'RETRY', ticket: null, error: 'RateLimited' };
    if (response.status >= 500) return { outcome: 'UNKNOWN', ticket: null, error: 'ExpoServerError' };
    if (!response.ok) return { outcome: 'FAILED', ticket: null, error: 'ExpoHttpError' };
    const body = await response.json();
    const ticket = Array.isArray(body.data) ? body.data[0] : body.data;
    if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id.length <= 200) {
      return { outcome: 'SENT', ticket: ticket.id, error: null };
    }
    if (ticket?.status === 'error') {
      const error = typeof ticket.details?.error === 'string' ? ticket.details.error : 'ExpoTicketError';
      return { outcome: permanent.has(error) ? 'FAILED' : 'RETRY', ticket: null, error };
    }
    return { outcome: 'UNKNOWN', ticket: null, error: 'InvalidExpoResponse' };
  } catch {
    return { outcome: 'UNKNOWN', ticket: null, error: 'NetworkFailure' };
  }
}

export interface DispatchRepository {
  claim(): Promise<{ delivery_id: string }[]>;
  prepare(id: string): Promise<PreparedPush[]>;
  finish(id: string, result: PushResult): Promise<void>;
}
export async function dispatchDuePushes(repository: DispatchRepository, fetcher: typeof fetch = fetch, accessToken?: string) {
  const summary = { selected: 0, sent: 0, retry: 0, failed: 0, unknown: 0, skipped: 0 };
  const claims = await repository.claim();
  summary.selected = claims.length;
  const deliver = async ({ delivery_id: id }: { delivery_id: string }) => {
    const [push] = await repository.prepare(id);
    if (!push) { summary.skipped++; return; }
    const result = await sendRevealPush(push, fetcher, accessToken);
    await repository.finish(id, result);
    summary[result.outcome.toLowerCase() as 'sent' | 'retry' | 'failed' | 'unknown']++;
  };
  // Bound throughput and wait for every in-flight request even if one DB write
  // fails, so the function never abandons outstanding sends on early rejection.
  for (let offset = 0; offset < claims.length; offset += 10) {
    const results = await Promise.allSettled(claims.slice(offset, offset + 10).map(deliver));
    if (results.some((result) => result.status === 'rejected')) throw new Error('Dispatch persistence failed');
  }
  return summary;
}
