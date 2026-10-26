import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  ACK_ACTION,
  ACK_REQUEST_TIMEOUT_MS,
  ACK_RETRY_DELAYS_MS,
  ackFeedback,
  acknowledgeFromNotification,
  onceEach,
  PAGE_CATEGORY,
  PAGE_DATA_KEY,
  pageAction,
  pageCategoryActions,
  type AckDeps,
  type AckMessages,
  type ActionResponse,
  type AckOutcome,
} from "./page-action";

const ids = {
  incident: "inc_01JB8Z0000000000000000000",
  workspace: "ws_01JB8Z0000000000000000000",
};

/** A tap as expo-notifications reports it on iOS: a push carries its user info as the trigger's payload. */
function tap(
  overrides: {
    action?: string;
    category?: string | null;
    payload?: unknown;
    data?: Record<string, unknown>;
  } = {},
): ActionResponse {
  return {
    actionIdentifier: overrides.action ?? ACK_ACTION,
    notification: {
      request: {
        identifier: "note-1",
        content: {
          title: "SEV1 · INC-142",
          categoryIdentifier: overrides.category === undefined ? PAGE_CATEGORY : overrides.category,
          data: overrides.data ?? {},
        },
        trigger: {
          type: "push",
          payload: "payload" in overrides ? overrides.payload : { aps: {}, [PAGE_DATA_KEY]: ids },
        },
      },
    },
  };
}

describe("the Acknowledge tap", () => {
  test("names the notification, the incident, its workspace and the page's title", () => {
    expect(pageAction(tap())).toEqual({
      notificationId: "note-1",
      title: "SEV1 · INC-142",
      ...ids,
    });
  });

  test("a notification the app posted itself carries the ids as data", () => {
    const local = tap({ payload: undefined, data: { [PAGE_DATA_KEY]: ids } });
    local.notification.request.trigger = null;
    expect(pageAction(local)).toMatchObject(ids);
  });

  test("anything else is not an ack: a plain tap, another category, a page without both ids", () => {
    expect(pageAction(tap({ action: "expo.modules.notifications.actions.DEFAULT" }))).toBeNull();
    expect(pageAction(tap({ category: null }))).toBeNull();
    expect(pageAction(tap({ category: "other" }))).toBeNull();
    expect(pageAction(tap({ payload: { page: { incident: ids.incident } } }))).toBeNull();
    expect(pageAction(tap({ payload: { page: "x" } }))).toBeNull();
    expect(pageAction(tap({ payload: null }))).toBeNull();
  });

  test("the action runs in the background, and only on an unlocked phone", () => {
    expect(pageCategoryActions("Confirmar")).toEqual([
      {
        identifier: ACK_ACTION,
        buttonTitle: "Confirmar",
        options: {
          opensAppToForeground: false,
          isAuthenticationRequired: true,
          isDestructive: false,
        },
      },
    ]);
  });

  test("the names match what the extension sets (BrigadePage.swift)", () => {
    const swift = readFileSync(
      new URL("../../modules/brigade-push/ios/BrigadePage.swift", import.meta.url),
      "utf8",
    );
    expect(swift).toContain(`category = "${PAGE_CATEGORY}"`);
    expect(swift).toContain(`ackAction = "${ACK_ACTION}"`);
    expect(swift).toContain(`dataKey = "${PAGE_DATA_KEY}"`);
    expect(swift).toContain(`["incident": incident, "workspace": workspace]`);
  });

  test("each tap is handled once", () => {
    const first = onceEach();
    expect(first("note-1")).toBe(true);
    expect(first("note-1")).toBe(false);
    expect(first("note-2")).toBe(true);
  });
});

type Call = { url: string; init: RequestInit };

/** A fake server answering each request in turn: a status (and body), or a thrown network error. */
function deps(
  answers: ({ status: number; body?: unknown } | "offline")[],
  more: Partial<AckDeps> = {},
) {
  const calls: Call[] = [];
  const slept: number[] = [];
  const keys = ["tap-1", "tap-2"];
  const made: AckDeps = {
    url: (workspace, incident) =>
      `https://brigade.test/api/workspaces/${workspace}/incidents/${incident}/ack`,
    cookie: async () => "better-auth.session_token=abc",
    fetch: async (url, init) => {
      calls.push({ url, init });
      const answer = answers.shift() ?? "offline";
      if (answer === "offline") throw new TypeError("Network request failed");
      return { status: answer.status, json: async () => answer.body ?? {} };
    },
    key: () => keys.shift()!,
    sleep: async (ms) => {
      slept.push(ms);
    },
    ...more,
  };
  return { deps: made, calls, slept };
}

describe("sending the ack", () => {
  test("posts to the incident as the member, with the session's cookie and a key, and no Origin", async () => {
    const fake = deps([{ status: 200, body: { ok: true } }]);
    expect(await acknowledgeFromNotification(ids, fake.deps)).toBe("acknowledged");
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call!.url).toBe(
      `https://brigade.test/api/workspaces/${ids.workspace}/incidents/${ids.incident}/ack`,
    );
    expect(call!.init.method).toBe("POST");
    expect(call!.init.headers).toEqual({
      Cookie: "better-auth.session_token=abc",
      "Idempotency-Key": "tap-1",
    });
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("the server's refusals are final, each with its own outcome", async () => {
    const cases: [{ status: number; body?: unknown }, AckOutcome][] = [
      [{ status: 409, body: { error: "conflict" } }, "already"],
      [{ status: 409, body: { error: "invalid_transition" } }, "inactive"],
      [{ status: 404, body: { error: "not_found" } }, "not_found"],
      [{ status: 403, body: { error: "forbidden" } }, "forbidden"],
      [{ status: 403, body: { error: "not_a_member" } }, "forbidden"],
      [{ status: 401, body: { error: "unauthenticated" } }, "signed_out"],
      [{ status: 400, body: { error: "invalid_args" } }, "failed"],
    ];
    for (const [answer, outcome] of cases) {
      const fake = deps([answer]);
      expect(await acknowledgeFromNotification(ids, fake.deps)).toBe(outcome);
      expect(fake.calls).toHaveLength(1);
    }
  });

  test("offline or failing: tried again on the backoff under the same key, then failed", async () => {
    const fake = deps(["offline", { status: 503 }, { status: 500 }]);
    expect(await acknowledgeFromNotification(ids, fake.deps)).toBe("failed");
    expect(fake.calls).toHaveLength(ACK_RETRY_DELAYS_MS.length);
    expect(fake.slept).toEqual(ACK_RETRY_DELAYS_MS.filter((ms) => ms > 0));
    const keys = fake.calls.map(
      (call) => (call.init.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(new Set(keys)).toEqual(new Set(["tap-1"]));
  });

  test("a retry that lands counts: the first request's answer was lost, the second is still this member's ack", async () => {
    const fake = deps(["offline", { status: 200 }]);
    expect(await acknowledgeFromNotification(ids, fake.deps)).toBe("acknowledged");
    expect(fake.calls).toHaveLength(2);
  });

  test("the whole try fits in the background time iOS gives (about 30 s)", () => {
    const waits = ACK_RETRY_DELAYS_MS.reduce<number>((sum, ms) => sum + ms, 0);
    expect(waits + ACK_RETRY_DELAYS_MS.length * ACK_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(25_000);
  });

  test("signed out, or a session that cannot be read: nothing is sent", async () => {
    for (const cookie of [async () => "", async () => Promise.reject(new Error("locked"))]) {
      const fake = deps([{ status: 200 }], { cookie });
      expect(await acknowledgeFromNotification(ids, fake.deps)).toBe("signed_out");
      expect(fake.calls).toHaveLength(0);
    }
  });

  test("a build without a server fails without sending", async () => {
    const fake = deps([{ status: 200 }], { url: () => undefined });
    expect(await acknowledgeFromNotification(ids, fake.deps)).toBe("failed");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("what the phone says after", () => {
  const messages = Object.fromEntries(
    (
      [
        "acknowledged",
        "already",
        "inactive",
        "not_found",
        "forbidden",
        "signed_out",
        "failed",
      ] as const
    ).map((outcome) => [outcome, () => `said ${outcome}`]),
  ) as AckMessages;
  const action = { notificationId: "note-1", title: "SEV1 · INC-142", ...ids };

  test("quietly, under the page's title, with nothing to tap", () => {
    for (const outcome of ["acknowledged", "already", "inactive", "forbidden"] as const) {
      expect(ackFeedback(action, outcome, messages)).toEqual({
        title: "SEV1 · INC-142",
        body: `said ${outcome}`,
        sound: false,
        interruptionLevel: "passive",
      });
    }
  });

  test("a failed ack is a page again: Acknowledge is one tap away", () => {
    const feedback = ackFeedback(action, "failed", messages);
    expect(feedback).toMatchObject({
      body: "said failed",
      interruptionLevel: "active",
      categoryIdentifier: PAGE_CATEGORY,
    });
    // The app's own notification carries the ids as data, which `pageAction` reads back.
    const retry = tap({ payload: undefined, data: feedback.data });
    retry.notification.request.trigger = null;
    expect(pageAction(retry)).toMatchObject(ids);
  });
});
