import { m } from "@freecorps/brigade-i18n";
import { createFileRoute } from "@tanstack/react-router";
import { IncidentsCard } from "@/components/incidents-card";
import { LegendCard } from "@/components/legend-card";
import { StackCard } from "@/components/stack-card";

export const Route = createFileRoute("/")({ component: Overview });

function Overview() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{m.overview_title()}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{m.overview_description()}</p>
      </div>
      <IncidentsCard />
      <StackCard />
      <LegendCard />
    </div>
  );
}
