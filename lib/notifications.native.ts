import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type { NotificationSupport } from './notifications';

const projectId = () => Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
export function notificationSupport(): NotificationSupport {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return { state: 'Unsupported in this environment', message: '원격 푸시 알림은 Expo Go 대신 네이티브 개발 빌드에서 테스트하세요.' };
  }
  if (!projectId()) return { state: 'Configuration required', message: 'EAS 프로젝트 ID가 필요합니다. 프로젝트 연결 후 개발 빌드를 설치하세요.' };
  return { state: 'Disabled', message: '숫자 공개 시 알림을 받을 수 있습니다. 알림을 켜려면 아래 버튼을 누르세요.' };
}
const allowed = (permission: Awaited<ReturnType<typeof import('expo-notifications').getPermissionsAsync>>) =>
  permission.granted || permission.ios?.status === 3; // iOS PROVISIONAL authorization

export async function notificationPermissionState(): Promise<import('@/domain/notifications').NotificationState> {
  const support = notificationSupport();
  if (support.state !== 'Disabled') return support.state;
  const notifications = await import('expo-notifications');
  const permission = await notifications.getPermissionsAsync();
  return allowed(permission) ? 'Enabled' : permission.status === 'denied' ? 'Permission denied' : 'Disabled';
}

export async function notificationPermissionGranted() {
  if (notificationSupport().state !== 'Disabled') return false;
  const notifications = await import('expo-notifications');
  return allowed(await notifications.getPermissionsAsync());
}
export async function getNotificationToken(requestPermission: boolean): Promise<string> {
  const support = notificationSupport();
  if (support.state !== 'Disabled') throw new Error(support.message);
  const notifications = await import('expo-notifications');
  // Android 13 requires a channel before its permission prompt/token acquisition.
  if (Platform.OS === 'android') await notifications.setNotificationChannelAsync('daily-reveal', {
    name: 'Daily reveal', importance: notifications.AndroidImportance.DEFAULT,
  });
  let permission = await notifications.getPermissionsAsync();
  if (!allowed(permission) && requestPermission && permission.canAskAgain) {
    permission = await notifications.requestPermissionsAsync();
  }
  if (!allowed(permission)) throw new Error('Permission denied');
  return (await notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
}
export function observeNotifications(onTap: (data: unknown) => void): () => void {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return () => {};
  let active = true;
  let cleanup: () => void = () => {};
  void import('expo-notifications').then((notifications) => {
    if (!active) return;
    notifications.setNotificationHandler({ handleNotification: async (notification) => ({
      shouldShowBanner: notification.request.content.data?.type === 'DAILY_REVEAL',
      shouldShowList: notification.request.content.data?.type === 'DAILY_REVEAL',
      shouldPlaySound: false, shouldSetBadge: false,
    }) });
    const seen = new Set<string>();
    const respond = (response: import('expo-notifications').NotificationResponse) => {
      if (!active || response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const id = response.notification.request.identifier;
      if (seen.has(id)) return;
      seen.add(id);
      onTap(response.notification.request.content.data);
      void notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const response = notifications.addNotificationResponseReceivedListener(respond);
    const received = notifications.addNotificationReceivedListener(() => { /* Reveal status refreshes independently. */ });
    const initial = notifications.getLastNotificationResponse();
    if (initial) respond(initial);
    cleanup = () => { response.remove(); received.remove(); notifications.setNotificationHandler(null); };
  }).catch(() => { /* Native module unavailable: Settings reports registration errors. */ });
  return () => { active = false; cleanup(); };
}
