import { setLocale } from "@freecorps/brigade-i18n";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { callScript, CallSession, speechLanguage, type ActiveCall } from "./call-session";

afterEach(() => setLocale("en"));

const CALL: ActiveCall = {
  id: "6f1c2a4e-9b3d-4c5e-8f70-1a2b3c4d5e6f",
  title: "SEV1 · Checkout down",
  body: "502s from payments.",
  incident: "inc_01M5PWGDG00000000000000001",
};

function setup(
  outcomes: MutationOutcome[] = [{ ok: true, version: 2 }],
  locale: "en" | "pt-BR" = "en",
) {
  const acks: string[] = [];
  const spoken: [string, string][] = [];
  const ended: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const session = new CallSession(
    {
      async ack(incident) {
        acks.push(incident);
        await gate;
        return outcomes.shift() ?? { ok: true, version: 3 };
      },
      speak: (text, language) => spoken.push([text, language]),
      endCall: (id) => ended.push(id),
    },
    () => locale,
  );
  return { session, acks, spoken, ended, release };
}

describe("callScript", () => {
  test("reads the incident, then how to acknowledge, in the user's language", () => {
    expect(callScript(CALL, "en")).toBe(
      "Brigade page. SEV1 · Checkout down. 502s from payments. Press 1 to acknowledge, or hang up to pass the page on.",
    );
    expect(callScript(CALL, "pt-BR")).toMatch(
      /^Acionamento do Brigade\. SEV1 · Checkout down\. .*Pressione 1/,
    );
    expect(speechLanguage("pt-BR")).toBe("pt-BR");
    expect(speechLanguage("en")).toBe("en-US");
  });
});

describe("CallSession", () => {
  test("answering reads the incident aloud once", () => {
    const { session, spoken } = setup();
    session.answered(CALL);
    session.answered(CALL);
    expect(spoken).toEqual([[callScript(CALL, "en"), "en-US"]]);
    expect(session.state?.ack).toEqual({ kind: "idle" });
  });

  test("acknowledging sends incident.ack once, says so and then hangs up", async () => {
    const { session, acks, spoken, ended, release } = setup();
    session.answered(CALL);
    const first = session.acknowledge();
    // A second press (the button and the keypad, or a double tap) while the first is in flight.
    const second = session.acknowledge(CALL.id);
    expect(session.state?.ack).toEqual({ kind: "sending" });
    release();
    await Promise.all([first, second]);
    expect(acks).toEqual([CALL.incident]);
    expect(session.state?.ack).toEqual({ kind: "acknowledged" });
    expect(spoken.at(-1)).toEqual(["Acknowledged. Thank you.", "en-US"]);
    session.spoken();
    expect(ended).toEqual([CALL.id]);
  });

  test("someone else acknowledging first counts: paging stopped", async () => {
    const { session, release } = setup([
      { ok: false, error: { code: "conflict", message: "Already acknowledged" } },
    ]);
    session.answered(CALL);
    release();
    await session.acknowledge();
    expect(session.state?.ack).toEqual({ kind: "acknowledged" });
  });

  test("a failure is shown and can be retried", async () => {
    const { session, acks, release, ended } = setup([
      { ok: false, error: { code: "closed", message: "closed" } },
    ]);
    session.answered(CALL);
    release();
    await session.acknowledge();
    expect(session.state?.ack).toEqual({
      kind: "failed",
      reason: "This page stopped syncing. Reload it to try again.",
    });
    session.spoken();
    expect(ended).toEqual([]);
    await session.acknowledge();
    expect(acks).toHaveLength(2);
    expect(session.state?.ack).toEqual({ kind: "acknowledged" });
  });

  test("a page without an incident cannot be acknowledged, and a key for another call is ignored", async () => {
    const { session, acks, release } = setup();
    release();
    session.answered({ ...CALL, incident: null });
    expect(session.state?.ack).toEqual({ kind: "unavailable" });
    await session.acknowledge();
    session.answered({ ...CALL, id: "other" });
    await session.acknowledge(CALL.id);
    expect(acks).toEqual([]);
  });

  test("hang up ends the call once; the platform's end marks it ended", () => {
    const { session, ended } = setup();
    session.answered(CALL);
    session.hangUp();
    session.ended(CALL.id);
    session.hangUp();
    expect(ended).toEqual([CALL.id]);
    expect(session.state?.ended).toBe(true);
  });

  test("speaks in Portuguese for a pt-BR user", () => {
    const { session, spoken } = setup(undefined, "pt-BR");
    session.answered(CALL);
    expect(spoken[0]?.[1]).toBe("pt-BR");
    expect(spoken[0]?.[0]).toContain("Pressione 1 para confirmar");
  });
});
