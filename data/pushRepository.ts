import { getSupabaseClient } from '@/lib/supabase';

async function pushRpc(name: string, args: Record<string, string>): Promise<boolean> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc(name, args);
  if (error || typeof data !== 'boolean') throw new Error('알림 등록을 서버에 저장하지 못했습니다. 연결을 확인하고 다시 시도하세요.');
  return data;
}
export function registerPushDevice(token: string, platform: 'android' | 'ios', installationId: string) {
  return pushRpc('register_push_device', { p_token: token, p_platform: platform, p_installation_id: installationId });
}
export function unregisterPushDevice(token: string) {
  return pushRpc('unregister_push_device', { p_token: token });
}
export function fetchPushDeviceStatus(token: string) {
  return pushRpc('get_push_device_status', { p_token: token });
}
