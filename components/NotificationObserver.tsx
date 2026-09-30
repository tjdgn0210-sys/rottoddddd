import { useEffect, useState } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import { useAuth } from '@/components/AuthProvider';
import { observeNotifications } from '@/lib/notifications';
import { notificationRoute } from '@/domain/notifications';
import { reconcilePushRegistration } from '@/lib/pushRegistration';

export function NotificationObserver() {
  const { user, isLoading } = useAuth();
  const navigation = useRootNavigationState();
  const [pendingReveal, setPendingReveal] = useState(false);
  useEffect(() => observeNotifications((data) => {
    if (notificationRoute(data)) setPendingReveal(true);
  }), []);
  useEffect(() => {
    if (!pendingReveal || isLoading || !navigation?.key || !user) return;
    // While signed out, keep the safe intent pending behind Stack.Protected.
    setPendingReveal(false);
    router.push('/reveal');
  }, [pendingReveal, isLoading, navigation?.key, user?.id]);
  useEffect(() => {
    if (user) void reconcilePushRegistration(user.id).catch(() => {});
  }, [user?.id]);
  return null;
}
