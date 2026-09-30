import type { NotificationState } from '@/domain/notifications';

export type NotificationSupport = { state: NotificationState; message: string };
export function notificationSupport(): NotificationSupport {
  return { state: 'Unsupported in this environment', message: '웹에서는 푸시 알림을 지원하지 않습니다. 네이티브 개발 빌드를 사용하세요.' };
}
export async function getNotificationToken(_requestPermission: boolean): Promise<string> {
  throw new Error(notificationSupport().message);
}
export async function notificationPermissionGranted() { return false; }
export async function notificationPermissionState(): Promise<NotificationState> { return 'Unsupported in this environment'; }
export function observeNotifications(_onTap: (data: unknown) => void): () => void { return () => {}; }
