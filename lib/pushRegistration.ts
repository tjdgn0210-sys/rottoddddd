import { Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { getSupabaseClient } from '@/lib/supabase';
import { sessionStorage } from '@/lib/sessionStorage';
import { fetchPushDeviceStatus, registerPushDevice, unregisterPushDevice } from '@/data/pushRepository';
import { getNotificationToken, notificationPermissionGranted, notificationPermissionState, notificationSupport } from '@/lib/notifications';
import type { NotificationState } from '@/domain/notifications';

const storageKey = 'six-days-push-registration-v1';
type Registration = { token: string; userId: string; installationId: string; enabled: boolean; pendingDisable?: boolean };
function read(): Registration | null {
  try { const raw = sessionStorage?.getItem(storageKey); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function save(value: Registration) { sessionStorage?.setItem(storageKey, JSON.stringify(value)); }
async function requireCurrentUser(userId: string) {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error || data.session?.user.id !== userId) throw new Error('로그인 계정이 변경되었습니다. 알림 설정을 다시 확인하세요.');
}
let busy = false;
let generation = 0;
// A single registration operation prevents enable/sign-out token races.
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('알림 설정을 처리 중입니다. 잠시 후 다시 시도하세요.');
  busy = true;
  try { return await work(); } finally { busy = false; }
}
export async function enablePushRegistration(userId: string, requestPermission = true) {
  const currentGeneration = generation;
  return exclusive(async () => {
    const old = read();
    const token = await getNotificationToken(requestPermission);
    if (currentGeneration !== generation) throw new Error('알림 등록이 취소되었습니다.');
    const installationId = old?.installationId ?? randomUUID();
    if (old?.userId === userId && old.token !== token) await unregisterPushDevice(old.token);
    await requireCurrentUser(userId);
    await registerPushDevice(token, Platform.OS as 'android' | 'ios', installationId);
    save({ token, userId, installationId, enabled: true });
    if (currentGeneration !== generation) {
      save({ token, userId, installationId, enabled: false, pendingDisable: true });
      await unregisterPushDevice(token);
      save({ token, userId, installationId, enabled: false });
    }
  });
}
export async function disablePushRegistration(userId: string) {
  generation++;
  const saved = read();
  if (saved?.userId === userId) save({ ...saved, enabled: false, pendingDisable: true });
  // An in-flight enable observes generation and disables its own result.
  if (busy) return;
  return exclusive(async () => {
    const old = read();
    if (!old || old.userId !== userId) return;
    // Persist retry intent before networking, including offline sign-out.
    save({ ...old, enabled: false, pendingDisable: true });
    await unregisterPushDevice(old.token);
    save({ ...old, enabled: false });
  });
}
export async function pushRegistrationStatus(userId: string): Promise<NotificationState> {
  const support = notificationSupport();
  if (support.state !== 'Disabled') return support.state;
  const permission = await notificationPermissionState();
  if (permission !== 'Enabled') return permission;
  const old = read();
  if (!old || old.userId !== userId || !old.enabled || old.pendingDisable) return 'Disabled';
  return await fetchPushDeviceStatus(old.token) ? 'Enabled' : 'Disabled';
}
// Restore only a previously opted-in registration. Never show a permission dialog.
export async function reconcilePushRegistration(userId: string) {
  const old = read();
  if (!old) return;
  if (old.userId === userId && old.pendingDisable) { await disablePushRegistration(userId); return; }
  if (old.userId !== userId) {
    // Transfer the same physical token to the new account in a narrow auth RPC,
    // then disable it. The new account must explicitly opt in.
    await exclusive(async () => {
      await requireCurrentUser(userId);
      await registerPushDevice(old.token, Platform.OS as 'android' | 'ios', old.installationId);
      save({ ...old, userId, enabled: false, pendingDisable: true });
      await unregisterPushDevice(old.token);
      save({ ...old, userId, enabled: false });
    });
    return;
  }
  if (old.enabled) {
    if (await notificationPermissionGranted()) await enablePushRegistration(userId, false);
    else await disablePushRegistration(userId);
  }
}
