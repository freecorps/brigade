// Stores the app's language on the signed-in user (`user.locale`), so emails come in it (RFC 0008), as the dashboard
// does from its language switch: when the user has none, and when the phone's language changed since the app last
// sent it (src/lib/locale.ts `localeAction`). Best effort: a failure is tried again on the next launch or change.
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { useLocale } from "@/hooks/use-locale";
import { authClient } from "@/lib/auth-client";
import { localeAction, sentLocaleKey } from "@/lib/locale";

export function useUserLocale(user: { id: string; locale?: string | null } | undefined): void {
  const { locale } = useLocale();
  const userId = user?.id;
  const userLocale = user?.locale;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        // Per user: another account on this phone has its own (src/lib/locale.ts `sentLocaleKey`).
        const key = sentLocaleKey(userId);
        const lastSent = await SecureStore.getItemAsync(key);
        const action = localeAction(locale, userLocale, lastSent);
        if (cancelled || action === "nothing") return;
        if (action === "send") {
          const { error } = await authClient.updateUser({ locale });
          if (error) return;
        }
        await SecureStore.setItemAsync(key, locale);
      } catch {
        // Offline or storage unavailable: the next launch tries again.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, userLocale, locale]);
}
