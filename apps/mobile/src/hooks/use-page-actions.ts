import { m } from "@freecorps/brigade-i18n";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { BrigadePush } from "../../modules/brigade-push";
import { authClient, server } from "@/lib/auth-client";
import {
  ACK_ACTION,
  ackFeedback,
  acknowledgeFromNotification,
  onceEach,
  PAGE_CATEGORY,
  pageAction,
  pageCategoryActions,
  type AckMessages,
  type ActionResponse,
} from "@/lib/page-action";

const messages: AckMessages = {
  acknowledged: () => m.push_ack_done(),
  already: () => m.push_ack_already(),
  inactive: () => m.push_ack_inactive(),
  not_found: () => m.push_ack_not_found(),
  forbidden: () => m.push_ack_forbidden(),
  signed_out: () => m.push_ack_signed_out(),
  failed: () => m.push_ack_failed(),
};

const firstTime = onceEach();

/**
 * An Acknowledge tap (src/lib/page-action.ts): sends the ack as the signed-in member, says how it went, and lets
 * the app be suspended again. Runs with the app in the background, which iOS keeps alive for it
 * (modules/brigade-push/ios/PageActions.swift).
 */
async function handle(response: ActionResponse): Promise<void> {
  const action = pageAction(response);
  if (!action) {
    // An Acknowledge tap this cannot act on still held background time.
    if (response.actionIdentifier === ACK_ACTION) {
      BrigadePush?.finishPageAction(response.notification.request.identifier);
    }
    return;
  }
  if (!firstTime(action.notificationId)) return;
  try {
    const outcome = await acknowledgeFromNotification(action, {
      url: (workspaceId, incidentId) => server?.ack(workspaceId, incidentId),
      cookie: () => authClient.getCookie(),
      fetch: (url, init) => fetch(url, init),
      key: () => `ack-${randomUUID()}`,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    await Notifications.scheduleNotificationAsync({
      content: ackFeedback(action, outcome, messages),
      trigger: null,
    }).catch(() => {});
  } finally {
    BrigadePush?.finishPageAction(action.notificationId);
  }
}

/**
 * Mounted once at the root, signed in or not: registers the pages' Acknowledge action in the app's language (again
 * when it changes) and handles its taps, including the one that launched the app in the background. iOS only for
 * now: Android pages show without the action (a tap opens the incident, src/hooks/use-page-taps.ts; RFC 0006).
 */
export function usePageActions(locale: string): void {
  useEffect(() => {
    if (process.env.EXPO_OS !== "ios") return;
    void Notifications.setNotificationCategoryAsync(
      PAGE_CATEGORY,
      pageCategoryActions(m.push_action_ack()),
    ).catch(() => {});
  }, [locale]);

  useEffect(() => {
    if (process.env.EXPO_OS !== "ios") return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handle(response);
    });
    // The tap that launched (or woke) the app may have arrived before this listener.
    const last = Notifications.getLastNotificationResponse();
    if (last) void handle(last);
    return () => subscription.remove();
  }, []);
}
