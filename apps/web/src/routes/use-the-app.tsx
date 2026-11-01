import { m } from "@freecorps/brigade-i18n";
import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { AddressQrCard, AppSignInCard } from "@/components/app-sign-in-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { UseAppCard } from "@/components/use-app-card";
import { usePageTitle } from "@/lib/page-title";

/**
 * "Use the app" (RFC 0015 sections 5, 6 and 8): which app to install, signing it in with a QR code, and the
 * address-only QR for a phone that signs in another way: `/use-the-app`, under the account.
 */
export const Route = createFileRoute("/use-the-app")({
  component: UseTheAppRoute,
  staticData: { section: "account", heading: "page" },
});

function UseTheAppRoute() {
  return (
    <RequireWorkspace>
      <UseTheApp />
    </RequireWorkspace>
  );
}

function UseTheApp() {
  // Read so a language switch rewords the page in place (the router memoizes route components).
  usePreferences();
  const title = m.use_app({ part: "title" });
  usePageTitle(title);
  return (
    <Page className="max-w-3xl">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-balance">{title}</h1>
        <p className="max-w-prose text-muted-foreground">
          {m.use_app({ part: "page_description" })}
        </p>
      </header>
      <UseAppCard />
      <AppSignInCard />
      <AddressQrCard />
    </Page>
  );
}
