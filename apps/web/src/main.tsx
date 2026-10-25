import { setLocale } from "@freecorps/brigade-i18n";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesProvider } from "@/components/preferences";
import { StackStatusProvider } from "@/components/stack-status";
import { readLocale } from "@/lib/locale";
import { getStorage } from "@/lib/storage";
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
      {/* The workspace's shard opens inside the dashboard route, once the session says which one (session.tsx). */}
      <StackStatusProvider>
        <RouterProvider router={router} />
      </StackStatusProvider>
    </PreferencesProvider>
  </StrictMode>,
);
