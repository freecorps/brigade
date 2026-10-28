// Who may sign up on the instance the app talks to (`GET /api/config`, RFC 0002 "Sign-up modes"): the sign-in screen
// offers "Create an account" only when it may, and the sign-up screen says sign-up is closed instead of a form.
import { readSignUpMode, type SignUpMode } from "@freecorps/brigade-i18n/auth";
import { useEffect, useState } from "react";
import { server } from "@/lib/auth-client";

let cached: Promise<SignUpMode> | undefined;

/**
 * The mode, asked once per launch (it changes only with a deploy). A failed answer, or no server, reads as `closed`
 * and is asked again next time. The app has no invitation flow of its own, so `closed` means no sign-up here.
 */
export function loadSignUpMode(
  url: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<SignUpMode> {
  if (!url) return Promise.resolve("closed");
  cached ??= fetcher(url, { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      return readSignUpMode(await response.json());
    })
    .catch(() => {
      cached = undefined;
      return "closed" as const;
    });
  return cached;
}

/** Forgets the cached mode (tests). */
export function resetSignUpMode() {
  cached = undefined;
}

/** The instance's sign-up mode; undefined until it answers. */
export function useSignUpMode(): SignUpMode | undefined {
  const [mode, setMode] = useState<SignUpMode>();
  useEffect(() => {
    let live = true;
    void loadSignUpMode(server?.config).then((next) => live && setMode(next));
    return () => {
      live = false;
    };
  }, []);
  return mode;
}
