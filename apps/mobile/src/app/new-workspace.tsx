import { m } from "@freecorps/brigade-i18n";
import { router } from "expo-router";
import { NewWorkspaceForm } from "@/components/new-workspace";

/** New workspace, from the Account tab: created, made active, and the sheet closes on it. */
export default function NewWorkspaceRoute() {
  return (
    <NewWorkspaceForm
      intro={m.account_flow({ part: "new_description", name: "" })}
      onDone={() => (router.canGoBack() ? router.back() : router.replace("/"))}
    />
  );
}
