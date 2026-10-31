// A status page's own domain (RFC 0012 "Custom domains"): a hostname the owner points at the instance with a CNAME,
// served through Cloudflare for SaaS custom hostnames, or a dedicated hostname the instance's operator attached to the
// status page edge themselves (`cloudflareId` null). The API claims the hostname in D1 and asks Cloudflare for it (it
// holds the token) or reaches the edge there; the shard keeps what the dashboard shows, written only by these
// server-only mutations, each with its event, which also keeps the public hostname → page lookup in step.

import { ACCOUNT_ACTOR } from "./devices.ts";
import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import { STATUS_PAGE_ID } from "./status.ts";
import type {
  StatusDomainError,
  StatusDomainRecord,
  StatusDomainRow,
  StatusDomainState,
} from "./tables.ts";
import { v } from "./validate.ts";

/** The one domain row of a workspace. */
export const STATUS_DOMAIN_ID = "status_domain";
export const STATUS_DOMAIN_STATES = ["pending", "active", "failed"] as const;
export const STATUS_DOMAIN_ERRORS = [
  "dns",
  "caa",
  "timed_out",
  "expired",
  "moved",
  "blocked",
  "deleted",
  "other",
  "not_attached",
] as const satisfies readonly StatusDomainError[];
/**
 * A domain pending or failed this long holds its hostname no more: another workspace may take it over (RFC 0012
 * "Custom domains"), so nobody keeps a name they never verified.
 */
export const STATUS_DOMAIN_SQUAT_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many DNS records are kept for the dashboard (a CNAME and Cloudflare's TXT records). */
export const STATUS_DOMAIN_RECORDS_MAX = 5;
const HOSTNAME_MAX = 253;

/** The hostname's event payload: never the token, only what the dashboard already shows. */
type Domain = { hostname: string; state: StatusDomainState };
export type StatusDomainAdded = DomainEvent<"status_domain.added", Domain>;
export type StatusDomainChecked = DomainEvent<
  "status_domain.checked",
  Domain & { previous: StatusDomainState }
>;
/** `takenOver`: another workspace took the hostname over after it sat unverified (`statusDomain.release`). */
export type StatusDomainRemoved = DomainEvent<
  "status_domain.removed",
  { hostname: string; takenOver?: true }
>;

/**
 * Whether `value` is a hostname a page may use: lowercase letters, digits and hyphens in dot-separated labels of 1 to
 * 63 characters (none starting or ending with a hyphen), at least two labels, at most 253 characters, and a last label
 * that is not all digits, so no IP address (an IPv6 one has colons, which no label takes). Punycode (`xn--`) is how an
 * internationalized name is written here.
 */
export function isStatusHostname(value: string): boolean {
  if (value.length > HOSTNAME_MAX) return false;
  const labels = value.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  return !/^\d+$/.test(labels.at(-1)!);
}

const recordArgs = v.object({
  type: v.picklist(["CNAME", "TXT"] as const),
  name: v.string({ min: 1, max: HOSTNAME_MAX }),
  value: v.string({ min: 1, max: 512 }),
});
/** Null: a dedicated hostname, with no custom hostname at Cloudflare. */
const cloudflareId = v.nullable(v.string({ min: 1, max: 64 }));
const checkedArgs = {
  state: v.picklist(STATUS_DOMAIN_STATES),
  records: v.array(recordArgs, { max: STATUS_DOMAIN_RECORDS_MAX }),
  error: v.nullable(v.picklist(STATUS_DOMAIN_ERRORS)),
};

/**
 * Server only (`status:manage`), once the API claimed `hostname` in D1 and Cloudflare created it (`cloudflareId`), or
 * reached the edge at a dedicated hostname (`cloudflareId` null): the page's domain, with its state and the records the
 * owner must create (none for a dedicated one). One per page: another is a `conflict`.
 */
export const addStatusDomain = defineMutation({
  name: "statusDomain.add",
  args: v.object({
    hostname: v.string({ min: 4, max: HOSTNAME_MAX }),
    cloudflareId,
    ...checkedArgs,
  }),
  permission: "status:manage",
  apply(store, args, ctx) {
    if (!store.get("status_page", STATUS_PAGE_ID)) {
      return fail("not_found", "The status page is not set up");
    }
    if (!isStatusHostname(args.hostname)) return fail("invalid_args", "Not a hostname");
    if (store.get("status_domain", STATUS_DOMAIN_ID)) {
      return fail("conflict", "The page already has a domain");
    }
    const row: StatusDomainRow = {
      id: STATUS_DOMAIN_ID,
      ...args,
      records: args.records as StatusDomainRecord[],
      checkedAt: ctx.now,
      stateAt: ctx.now,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
    };
    store.insert("status_domain", row);
    const event: StatusDomainAdded = {
      type: "status_domain.added",
      subject: STATUS_DOMAIN_ID,
      data: { hostname: row.hostname, state: row.state },
    };
    return ok(event);
  },
});

/**
 * Server only: what Cloudflare says now about the domain, or what reaching the edge at a dedicated hostname found
 * (`hostname` and `cloudflareId` must still be the page's, so an answer about a hostname removed and added again
 * meanwhile changes nothing): its state, records and the time asked. The event says the state it moved from
 * (`previous`, the same when it did not move).
 */
export const checkStatusDomain = defineMutation({
  name: "statusDomain.check",
  args: v.object({
    hostname: v.string({ min: 4, max: HOSTNAME_MAX }),
    cloudflareId,
    ...checkedArgs,
  }),
  permission: "status:manage",
  apply(store, args, ctx) {
    const current = store.get("status_domain", STATUS_DOMAIN_ID);
    if (
      !current ||
      current.hostname !== args.hostname ||
      current.cloudflareId !== args.cloudflareId
    ) {
      return fail("not_found", "No such domain on the page");
    }
    store.update("status_domain", STATUS_DOMAIN_ID, {
      state: args.state,
      records: args.records as StatusDomainRecord[],
      error: args.error,
      checkedAt: ctx.now,
      ...(args.state === current.state ? {} : { stateAt: ctx.now }),
    });
    const event: StatusDomainChecked = {
      type: "status_domain.checked",
      subject: STATUS_DOMAIN_ID,
      data: { hostname: args.hostname, state: args.state, previous: current.state },
    };
    return ok(event);
  },
});

/** Server only, once Cloudflare deleted it (a dedicated hostname has nothing there): the page has no domain again. */
export const removeStatusDomain = defineMutation({
  name: "statusDomain.remove",
  args: v.object({ hostname: v.string({ min: 4, max: HOSTNAME_MAX }) }),
  permission: "status:manage",
  apply(store, args) {
    const current = store.get("status_domain", STATUS_DOMAIN_ID);
    if (!current || current.hostname !== args.hostname) {
      return fail("not_found", "No such domain on the page");
    }
    store.delete("status_domain", STATUS_DOMAIN_ID);
    const event: StatusDomainRemoved = {
      type: "status_domain.removed",
      subject: STATUS_DOMAIN_ID,
      data: { hostname: args.hostname },
    };
    return ok(event);
  },
});

/**
 * Server only, as `ACCOUNT_ACTOR`: another workspace takes the hostname over (RFC 0012 "Custom domains"), before the
 * API deletes it at Cloudflare (a dedicated hostname has nothing there). Only a domain still `cloudflareId`, not
 * active, and in its state since `before` or earlier (`STATUS_DOMAIN_SQUAT_MS` ago); else `conflict`, and the domain
 * stays.
 */
export const releaseStatusDomain = defineMutation({
  name: "statusDomain.release",
  args: v.object({
    hostname: v.string({ min: 4, max: HOSTNAME_MAX }),
    cloudflareId,
    before: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  }),
  permission: "status:manage",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== ACCOUNT_ACTOR.kind || ctx.actor.id !== ACCOUNT_ACTOR.id) {
      return fail("forbidden", "Only Brigade releases a domain");
    }
    const current = store.get("status_domain", STATUS_DOMAIN_ID);
    if (
      !current ||
      current.hostname !== args.hostname ||
      current.cloudflareId !== args.cloudflareId
    ) {
      return fail("not_found", "No such domain on the page");
    }
    if (current.state === "active" || current.stateAt > args.before) {
      return fail("conflict", "The domain is not left unverified");
    }
    store.delete("status_domain", STATUS_DOMAIN_ID);
    const event: StatusDomainRemoved = {
      type: "status_domain.removed",
      subject: STATUS_DOMAIN_ID,
      data: { hostname: args.hostname, takenOver: true },
    };
    return ok(event);
  },
});

/** The page's domain, for the dashboard (everyone reads it, like the page's settings). */
export const statusDomainQuery = defineQuery({
  name: "statusDomain.get",
  args: v.object({}),
  permission: "status:read",
  table: "status_domain",
  filter: () => true,
});

export const statusDomainServerMutations = [
  addStatusDomain,
  checkStatusDomain,
  removeStatusDomain,
  releaseStatusDomain,
] as const;
