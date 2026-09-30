export const REVEAL_NOTIFICATION_ROUTE = '/reveal' as const;

// Never accept arbitrary URLs or notification payload state as authority.
export function notificationRoute(data: unknown): typeof REVEAL_NOTIFICATION_ROUTE | null {
  return data !== null && typeof data === 'object' && 'type' in data && data.type === 'DAILY_REVEAL'
    ? REVEAL_NOTIFICATION_ROUTE : null;
}

export type NotificationState = 'Enabled' | 'Disabled' | 'Permission denied' | 'Unsupported in this environment' | 'Configuration required';
