// @vitest-environment happy-dom
// The overview's warning about schedules with a layer that has nobody in it (RFC 0003 "Schedules", Q20): which
// schedules it names, its links to their rows in the On-call card (on the On call page), its wording for each role and language, and that
// it says nothing while every layer has someone.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ScheduleLayer, ScheduleRow } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { GAPS_SHOWN, OnCallGapsView } from "../src/components/oncall-gaps";
import { PreferencesProvider } from "../src/components/preferences";
import { scheduleAnchor, scheduleGaps, type ScheduleGap } from "../src/lib/oncall";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const layer = (members: string[], name = ""): ScheduleLayer => ({
  id: "lyr_01JB0000000000000000000001",
  name,
  members,
  startDate: "2026-10-05",
  handoffTime: "09:00",
  unit: "weeks",
  count: 1,
});
const row = (id: string, name: string, layers: ScheduleLayer[]): ScheduleRow => ({
  id,
  name,
  timeZone: "America/Sao_Paulo",
  layers,
  createdAt: 0,
  createdBy: "usr_ana",
  updatedAt: 0,
});

describe("scheduleGaps", () => {
  test("names each schedule with an empty layer, and which layers, in the list's order", () => {
    const rows = [
      row("sch_1", "Database", [layer(["usr_ana"])]),
      row("sch_2", "Platform", [layer(["usr_ana"]), layer([]), layer([], "Nights")]),
      row("sch_3", "Support", [layer([])]),
    ];
    expect(scheduleGaps(rows)).toEqual([
      { id: "sch_2", name: "Platform", layers: ["Layer 2", "Nights"] },
      { id: "sch_3", name: "Support", layers: ["Primary"] },
    ]);
    expect(scheduleGaps([rows[0]!])).toEqual([]);
    expect(scheduleGaps([])).toEqual([]);
    expect(scheduleAnchor("sch_2")).toBe("schedule-sch_2");
  });
});

describe("OnCallGapsView", () => {
  let root: Root | undefined;
  let container: HTMLElement;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
  });

  // Its links are the router's, so it renders as the only route of a router of its own.
  async function mount(gaps: ScheduleGap[], manage: boolean, locale: "en" | "pt-BR" = "en") {
    void setI18nLocale(locale);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => <OnCallGapsView gaps={gaps} manage={manage} locale={locale} />,
      }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await act(async () => {
      root!.render(
        <PreferencesProvider initialLocale={locale}>
          <RouterProvider router={router} />
        </PreferencesProvider>,
      );
      await router.load();
    });
  }

  test("nothing while every layer has someone", async () => {
    await mount([], true);
    expect(container.textContent).toBe("");
  });

  test("links each schedule to its row in the On-call card, with what an owner can do", async () => {
    await mount([{ id: "sch_2", name: "Platform", layers: ["Layer 2", "Nights"] }], true);
    expect(container.querySelector("h2")?.textContent).toBe(
      "A schedule has a layer with nobody in it",
    );
    const link = container.querySelector("a")!;
    expect(link.textContent).toBe("Platform");
    expect(link.getAttribute("href")).toBe("/on-call#schedule-sch_2");
    expect(container.textContent).toContain("Nobody in Layer 2 and Nights");
    expect(container.textContent).toContain("Edit the schedule to add someone");
  });

  test("a responder is told to ask; many schedules are counted, listed up to a few, in Portuguese too", async () => {
    const gaps = Array.from({ length: GAPS_SHOWN + 3 }, (_, index) => ({
      id: `sch_${index}`,
      name: `Schedule ${index}`,
      layers: ["Primary"],
    }));
    await mount(gaps, false, "pt-BR");
    try {
      expect(container.querySelector("h2")?.textContent).toBe(
        "8 escalas têm uma camada sem ninguém",
      );
      expect(container.querySelectorAll("li")).toHaveLength(GAPS_SHOWN);
      expect(container.textContent).toContain("Peça a um proprietário ou admin");
      const more = [...container.querySelectorAll("a")].at(-1)!;
      expect(more.textContent).toBe("mais 3");
      expect(more.getAttribute("href")).toBe("/on-call#oncall");
    } finally {
      void setI18nLocale("en");
    }
  });
});
