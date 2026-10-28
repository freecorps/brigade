// @vitest-environment happy-dom
// A status page's own domain on the dashboard (RFC 0012 "Custom domains"): the card and its calls to the API.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { StatusDomainRow } from "@freecorps/brigade-schema";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { StatusDomainPanel } from "../src/components/status-domain-card";
import { addDomain, checkDomain, loadDomainConfig, removeDomain } from "../src/lib/status-domain";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  void setI18nLocale("en");
});

function mount(element: ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

const button = (container: Element, text: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(text));

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const NAME = "status.northwind-industries-holdings.example.com";
const row = (extra: Partial<StatusDomainRow> = {}): StatusDomainRow => ({
  id: "status_domain",
  hostname: NAME,
  cloudflareId: "cfh-1",
  state: "pending",
  records: [
    { type: "CNAME", name: NAME, value: "status-origin.example.net" },
    {
      type: "TXT",
      name: `_cf-custom-hostname.${NAME}`,
      value: "6f1c2b0e-3d4a-4b5c-9e8f-0a1b2c3d4e5f",
    },
  ],
  error: null,
  checkedAt: Date.UTC(2026, 9, 27, 12),
  createdAt: 0,
  createdBy: "usr_ana",
  ...extra,
});

function panel(props: Partial<Parameters<typeof StatusDomainPanel>[0]> = {}) {
  const calls: string[] = [];
  const ok = async () => ({ ok: true }) as const;
  const container = mount(
    <StatusDomainPanel
      target="status-origin.example.net"
      ready
      loading={false}
      domain={null}
      manage
      onAdd={async (hostname) => {
        calls.push(`add ${hostname}`);
        return ok();
      }}
      onCheck={async () => {
        calls.push("check");
        return ok();
      }}
      onRemove={async () => {
        calls.push("remove");
        return ok();
      }}
      {...props}
    />,
  );
  return { container, calls };
}

describe("custom domain card", () => {
  test("adds a domain, saying where the CNAME points and why one was refused", async () => {
    let refuse = true;
    const { container, calls } = panel({
      onAdd: async (hostname) => {
        calls.push(`add ${hostname}`);
        return refuse ? { ok: false, error: "hostname_taken" } : { ok: true };
      },
    });
    expect(container.textContent).toContain("Point a CNAME at status-origin.example.net.");
    act(() => button(container, "Add domain")!.click());
    expect(container.textContent).toContain("Enter a domain.");
    expect(calls).toEqual([]);
    act(() => type(container.querySelector("input")!, " status.acme.example "));
    await act(async () => button(container, "Add domain")!.click());
    expect(calls).toEqual(["add status.acme.example"]);
    expect(container.textContent).toContain("already in use by another status page");
    refuse = false;
    await act(async () => button(container, "Add domain")!.click());
    expect(container.textContent).not.toContain("already in use");
  });

  test("a pending domain shows the records to create and checks again; an active one hides them", async () => {
    const { container, calls } = panel({ domain: row() });
    expect(container.textContent).toContain("Pending");
    expect(container.textContent).toContain("DNS records to create");
    expect(container.textContent).toContain(`_cf-custom-hostname.${NAME}`);
    await act(async () => button(container, "Check again")!.click());
    expect(calls).toEqual(["check"]);
    act(() => root?.unmount());
    const active = panel({ domain: row({ state: "active" }) }).container;
    expect(active.textContent).toContain("Active");
    expect(active.textContent).not.toContain("DNS records to create");
    expect(button(active, "Check again")).toBeUndefined();
  });

  test("a failed domain says Cloudflare's reason; removing asks first", async () => {
    const { container, calls } = panel({
      domain: row({ state: "failed", error: "custom hostname does not CNAME to this zone" }),
    });
    expect(container.textContent).toContain("Failed");
    expect(container.textContent).toContain("does not CNAME to this zone");
    act(() => button(container, "Remove domain")!.click());
    expect(container.textContent).toContain(`Remove ${NAME}?`);
    expect(calls).toEqual([]);
    await act(async () => button(container, "Remove domain")!.click());
    expect(calls).toEqual(["remove"]);
  });

  test("read only for others, not set up without a page, and in pt-BR", async () => {
    const viewer = panel({ manage: false, domain: row() }).container;
    expect(button(viewer, "Check again")).toBeUndefined();
    expect(button(viewer, "Remove domain")).toBeUndefined();
    expect(viewer.textContent).toContain("Owners and admins can add or remove the domain.");
    act(() => root?.unmount());
    expect(panel({ ready: false }).container.textContent).toContain("Set up the status page first");
    act(() => root?.unmount());
    await setI18nLocale("pt-BR");
    const pt = panel({ domain: row() }).container;
    expect(pt.textContent).toContain("Domínio próprio");
    expect(pt.textContent).toContain("Registros DNS a criar");
  });
});

describe("the API calls", () => {
  const fake = (status: number, body: unknown) => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetcher = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body as string | undefined });
      return Response.json(body, { status });
    }) as typeof fetch;
    return { calls, fetcher };
  };
  test("reads whether the instance has custom domains, and sends each change to its route", async () => {
    const on = fake(200, { configured: true, target: "status-origin.example.net" });
    expect(await loadDomainConfig("ws_1", on.fetcher)).toEqual({
      configured: true,
      target: "status-origin.example.net",
    });
    expect(await loadDomainConfig("ws_1", fake(200, { configured: false }).fetcher)).toEqual({
      configured: false,
    });
    expect(await loadDomainConfig("ws_1", fake(503, {}).fetcher)).toBeNull();
    const done = fake(200, { ok: true });
    await addDomain("ws_1", "status.acme.example", done.fetcher);
    await checkDomain("ws_1", done.fetcher);
    await removeDomain("ws_1", done.fetcher);
    expect(done.calls).toEqual([
      {
        url: "/api/workspaces/ws_1/status-page/domain",
        method: "PUT",
        body: JSON.stringify({ hostname: "status.acme.example" }),
      },
      { url: "/api/workspaces/ws_1/status-page/domain/check", method: "POST", body: undefined },
      { url: "/api/workspaces/ws_1/status-page/domain", method: "DELETE", body: undefined },
    ]);
    expect(await addDomain("ws_1", "x", fake(400, { error: "own_domain" }).fetcher)).toEqual({
      ok: false,
      error: "own_domain",
    });
    expect(await addDomain("ws_1", "x", fake(500, { error: "weird" }).fetcher)).toEqual({
      ok: false,
      error: "failed",
    });
  });
});
