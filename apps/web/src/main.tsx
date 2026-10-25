import { setLocale } from "@freecorps/brigade-i18n";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesProvider } from "@/components/preferences";
import { StackStatusProvider } from "@/components/stack-status";
import { readLocale } from "@/lib/locale";
import { DEMO_WORKSPACE } from "@/lib/stack";
import { getStorage } from "@/lib/storage";
import { syncClient } from "@/sync-client";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// The i18n runtime starts in `en`; set the stored (or browser) locale before the first render.
const locale = readLocale(getStorage(), navigator.languages);
void setLocale(locale);
document.documentElement.lang = locale;

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <PreferencesProvider initialLocale={locale}>
      {/* The workspace's shard: until auth and workspaces exist, the same demo workspace the stack card checks. */}
      <SyncProvider client={syncClient} shard={DEMO_WORKSPACE}>
        <StackStatusProvider>
          <RouterProvider router={router} />
        </StackStatusProvider>
      </SyncProvider>
    </PreferencesProvider>
  </StrictMode>,
);
