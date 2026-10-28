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
    { type: "CNAME", name: NAME, value: "status-origin.saas.test" },
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
      target="status-origin.saas.test"
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
    expect(container.textContent).toContain("Point a CNAME at status-origin.saas.test.");
    act(() => button(container, "Add domain")!.click());
    expect(container.textContent).toContain("Enter a domain.");
    expect(calls).toEqual([]);
    act(() => type(container.querySelector("input")!, " status.acme.test "));
    await act(async () => button(container, "Add domain")!.click());
    expect(calls).toEqual(["add status.acme.test"]);
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

  test("a failed domain says Cloudflare's reason in the dashboard's words; removing asks first", async () => {
    const { container, calls } = panel({ domain: row({ state: "failed", error: "moved" }) });
    expect(container.textContent).toContain("Failed");
    expect(container.textContent).toContain("no longer points at this Brigade instance");
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
    act(() => root?.unmount());
    const reason = panel({ domain: row({ error: "dns" }) }).container;
    expect(reason.textContent).toContain("A Cloudflare ainda não encontra os registros DNS");
  });

  test("each refusal and each of Cloudflare's reasons has words of its own, in both languages", async () => {
    const words = {
      en: {
        dns: "can't see the DNS records yet",
        caa: "A CAA record",
        timed_out: "stopped waiting for the records",
        expired: "certificate expired",
        moved: "no longer points at this Brigade instance",
        blocked: "Cloudflare blocked this domain",
        deleted: "Cloudflare no longer has this domain",
        other: "Cloudflare reported a problem with the domain",
        unavailable: "Brigade couldn't save the domain right now",
        in_progress: "still being set up or cleaned up",
        apex: "Use a subdomain",
      },
      "pt-BR": {
        dns: "ainda não encontra os registros DNS",
        caa: "Um registro CAA",
        timed_out: "parou de esperar pelos registros",
        expired: "certificado do domínio expirou",
        moved: "não aponta mais para esta instância do Brigade",
        blocked: "A Cloudflare bloqueou este domínio",
        deleted: "A Cloudflare não tem mais este domínio",
        other: "A Cloudflare informou um problema com o domínio",
        unavailable: "O Brigade não conseguiu salvar o domínio agora",
        in_progress: "ainda está sendo configurado ou removido",
        apex: "Use um subdomínio",
      },
    } as const;
    for (const locale of ["en", "pt-BR"] as const) {
      await setI18nLocale(locale);
      for (const error of [
        "dns",
        "caa",
        "timed_out",
        "expired",
        "moved",
        "blocked",
        "deleted",
        "other",
      ] as const) {
        const { container } = panel({ domain: row({ state: "failed", error }) });
        expect(container.textContent, `${locale} ${error}`).toContain(words[locale][error]);
        act(() => root?.unmount());
      }
      for (const error of ["unavailable", "in_progress", "apex"] as const) {
        const { container } = panel({ onAdd: async () => ({ ok: false, error }) });
        act(() => type(container.querySelector("input")!, "status.acme.test"));
        const add = locale === "en" ? "Add domain" : "Adicionar domínio";
        await act(async () => button(container, add)!.click());
        expect(container.textContent, `${locale} ${error}`).toContain(words[locale][error]);
        act(() => root?.unmount());
      }
    }
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
    const on = fake(200, { configured: true, target: "status-origin.saas.test" });
    expect(await loadDomainConfig("ws_1", on.fetcher)).toEqual({
      configured: true,
      target: "status-origin.saas.test",
    });
    expect(await loadDomainConfig("ws_1", fake(200, { configured: false }).fetcher)).toEqual({
      configured: false,
    });
    expect(await loadDomainConfig("ws_1", fake(503, {}).fetcher)).toBeNull();
    const done = fake(200, { ok: true });
    await addDomain("ws_1", "status.acme.test", done.fetcher);
    await checkDomain("ws_1", done.fetcher);
    await removeDomain("ws_1", done.fetcher);
    expect(done.calls).toEqual([
      {
        url: "/api/workspaces/ws_1/status-page/domain",
        method: "PUT",
        body: JSON.stringify({ hostname: "status.acme.test" }),
      },
      { url: "/api/workspaces/ws_1/status-page/domain/check", method: "POST", body: undefined },
      { url: "/api/workspaces/ws_1/status-page/domain", method: "DELETE", body: undefined },
    ]);
    expect(await addDomain("ws_1", "x", fake(400, { error: "own_domain" }).fetcher)).toEqual({
      ok: false,
      error: "own_domain",
    });
    for (const error of ["unavailable", "in_progress", "apex"]) {
      expect(await addDomain("ws_1", "x", fake(409, { error }).fetcher), error).toEqual({
        ok: false,
        error,
      });
    }
    expect(await addDomain("ws_1", "x", fake(500, { error: "weird" }).fetcher)).toEqual({
      ok: false,
      error: "failed",
    });
  });
});
