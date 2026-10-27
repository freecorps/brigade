import { formatRelativeTime, m, type Locale } from "@freecorps/brigade-i18n";
import {
  apiTokenState,
  can,
  type ApiTokenRow,
  type MemberRow,
  type Permission,
  type Role,
} from "@freecorps/brigade-schema";
import { useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { CheckIcon, CopyIcon, KeyRoundIcon, PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { formatAge } from "@/lib/incidents";
import { people, personName } from "@/lib/timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  checkTokenDraft,
  emptyTokenDraft,
  EXPIRY_CHOICES,
  grantable,
  mintToken,
  revokeToken,
  SCOPE_GROUPS,
  scopeLabel,
  tokenText,
  type DraftIssues,
  type MintResult,
  type TokenDraft,
} from "@/lib/api-tokens";

type TokenState = ReturnType<typeof apiTokenState>;

const STATES: Record<TokenState, "resolved" | "declined" | "outline"> = {
  active: "resolved",
  revoked: "declined",
  expired: "declined",
  // Still listed as working nowhere: the one that asks for a look, without the alarm of a failing page.
  disabled: "outline",
};

/**
 * The workspace's API tokens (RFC 0014): owners and admins create one (name, scopes up to their own role, expiry),
 * see it once with Copy, read each one's state and last use, and revoke it after a confirmation. The list is live
 * from the shard (`apiToken.all`); the token itself never is.
 */
export function ApiTokensCard() {
  const { role } = useMember();
  if (!can(role, "token:manage")) return <TokensManageOnly />;
  return <ManagedTokens />;
}

function ManagedTokens() {
  const { workspaceId, userId, role } = useMember();
  const { locale } = usePreferences();
  const [attempt, setAttempt] = useState(0);
  const { rows, status } = useQuery("apiToken.all", {});
  const members = useQuery("members.all", {});
  const now = useNow(30_000);
  return (
    <ApiTokensPanel
      key={attempt}
      rows={rows}
      members={members.rows}
      self={userId}
      role={role}
      loading={status === "loading"}
      failed={status === "error"}
      locale={locale}
      now={now}
      onCreate={(draft) => mintToken(workspaceId, draft)}
      onRevoke={(id) => revokeToken(workspaceId, id)}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}

function TokensManageOnly() {
  return (
    <Card aria-labelledby="api-tokens-title">
      <Header />
      <CardContent>
        <p className="text-sm text-muted-foreground">{tokenText("manage_only")}</p>
      </CardContent>
    </Card>
  );
}

function Header({ action }: { action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 sm:px-6">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <CardTitle id="api-tokens-title" className="truncate">
          {tokenText("title")}
        </CardTitle>
        {action}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">{tokenText("description")}</p>
    </div>
  );
}

type PanelProps = {
  rows: readonly ApiTokenRow[];
  members: readonly MemberRow[];
  self: string;
  role: Role;
  loading: boolean;
  failed: boolean;
  locale: Locale;
  now: number;
  onCreate: (draft: TokenDraft) => Promise<MintResult>;
  onRevoke: (id: string) => Promise<boolean>;
  onRetry: () => void;
};

/** The card itself, without the hooks: what each state looks like (tested and screenshotted with made-up data). */
export function ApiTokensPanel({
  rows,
  members,
  self,
  role,
  loading,
  failed,
  locale,
  now,
  onCreate,
  onRevoke,
  onRetry,
}: PanelProps) {
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<{ token: string; name: string } | null>(null);
  const who = people(self, members);
  const isMember = (id: string) => who.members.has(id);
  // Live ones first, each group newest first (the query's order).
  const ordered = [...rows].sort(
    (a, b) =>
      Number(apiTokenState(a, now, isMember) !== "active") -
      Number(apiTokenState(b, now, isMember) !== "active"),
  );
  return (
    <Card aria-labelledby="api-tokens-title">
      <Header
        action={
          !adding && !loading && !failed ? (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden />
              {tokenText("add")}
            </Button>
          ) : null
        }
      />
      <CardContent className="flex flex-col gap-4">
        {shown ? <TokenOnce shown={shown} onDismiss={() => setShown(null)} /> : null}
        {adding ? (
          <TokenForm
            role={role}
            onCancel={() => setAdding(false)}
            onSubmit={async (draft) => {
              const result = await onCreate(draft);
              if (!result.ok) return result.part;
              setAdding(false);
              setShown({ token: result.token, name: result.name || draft.name.trim() });
              return null;
            }}
          />
        ) : null}
        {loading ? null : failed ? (
          <div className="flex flex-col items-start gap-2">
            <FormError>{tokenText("load_failed")}</FormError>
            <Button variant="outline" onClick={onRetry}>
              <RotateCwIcon aria-hidden />
              {tokenText("retry")}
            </Button>
          </div>
        ) : ordered.length ? (
          <ul className="-mx-4 divide-y border-t sm:-mx-6">
            {ordered.map((row) => (
              <TokenItem
                key={row.id}
                row={row}
                state={apiTokenState(row, now, isMember)}
                by={personName(row.createdBy, who, "object")}
                locale={locale}
                now={now}
                onRevoke={onRevoke}
              />
            ))}
          </ul>
        ) : !adding ? (
          <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {tokenText("empty")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TokenItem({
  row,
  state,
  by,
  locale,
  now,
  onRevoke,
}: {
  row: ApiTokenRow;
  state: TokenState;
  by: string;
  locale: Locale;
  now: number;
  onRevoke: (id: string) => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const goRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) goRef.current?.focus();
  }, [confirm]);
  const ended = state === "revoked" || state === "expired";
  const facts = [
    tokenText("by", { name: by }),
    row.lastUsedAt === null
      ? tokenText("used_never")
      : tokenText("used", { when: formatAge(row.lastUsedAt, now, locale) }),
    ended
      ? null
      : row.expiresAt === null
        ? tokenText("expires_never")
        : // In the future: `formatAge` would read any time to come as "just now".
          tokenText("expires", { when: formatRelativeTime(row.expiresAt, locale, now) }),
  ].filter((fact): fact is string => fact !== null);
  return (
    <li className={cn("flex flex-col gap-3 px-4 py-4 sm:px-6", ended && "text-muted-foreground")}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <KeyRoundIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{row.name}</p>
            <Badge variant={STATES[state]}>{tokenText(`state_${state}`)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {facts.join(" · ")}
          </p>
          <p className="text-sm [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">{tokenText("scopes_label")}: </span>
            {row.scopes.map((scope) => scopeLabel(scope)).join(", ")}
          </p>
        </div>
        {state !== "revoked" && !confirm ? (
          <Button variant="outline" onClick={() => setConfirm(true)}>
            {tokenText("revoke")}
          </Button>
        ) : null}
      </div>
      {confirm ? (
        <div className="flex flex-col gap-3 rounded-md bg-muted p-3">
          <p className="max-w-prose text-sm text-foreground [overflow-wrap:anywhere]">
            {tokenText("revoke_confirm", { name: row.name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={goRef}
              variant="destructive"
              className={CONFIRM_DESTRUCTIVE}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setFailed(false);
                const ok = await onRevoke(row.id);
                setBusy(false);
                if (ok) setConfirm(false);
                else setFailed(true);
              }}
            >
              {tokenText(busy ? "revoking" : "revoke_go")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              {tokenText("keep")}
            </Button>
          </div>
          {failed ? <FormError>{tokenText("revoke_failed")}</FormError> : null}
        </div>
      ) : null}
    </li>
  );
}

function TokenForm({
  role,
  onCancel,
  onSubmit,
}: {
  role: Role;
  onCancel: () => void;
  /** Resolves with the failure's message part, or null once created. */
  onSubmit: (draft: TokenDraft) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<TokenDraft>(emptyTokenDraft);
  const [issues, setIssues] = useState<DraftIssues>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scopesErrorId = useId();
  const expiryId = useId();
  const allowed = grantable(role);
  const toggle = (scope: Permission, on: boolean) =>
    setDraft((current) => ({
      ...current,
      scopes: on ? [...current.scopes, scope] : current.scopes.filter((one) => one !== scope),
    }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = checkTokenDraft(draft);
    setIssues(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setProblem(null);
    const part = await onSubmit(draft);
    setBusy(false);
    if (part === "name_invalid") setIssues({ name: tokenText(part) });
    else if (part !== null) setProblem(tokenText(part));
  };
  return (
    <form className="flex flex-col gap-5 rounded-md border p-4" onSubmit={submit} noValidate>
      <Field
        label={tokenText("name_label")}
        hint={tokenText("name_hint")}
        error={issues.name}
        value={draft.name}
        maxLength={120}
        autoComplete="off"
        autoFocus
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />
      <fieldset
        className="flex min-w-0 flex-col gap-3"
        aria-describedby={issues.scopes ? scopesErrorId : undefined}
      >
        <legend className="mb-1 text-sm font-medium">{tokenText("scopes_label")}</legend>
        <div className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCOPE_GROUPS.map((group) => (
            <div key={group.resource} className="flex min-w-0 flex-col gap-0.5">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {tokenText(`group_${group.resource}`)}
              </p>
              {group.scopes.map((scope) => (
                <label
                  key={scope}
                  className={cn(
                    "flex min-h-9 items-center gap-2.5 text-sm",
                    !allowed.includes(scope) && "text-muted-foreground",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    disabled={!allowed.includes(scope)}
                    checked={draft.scopes.includes(scope)}
                    onChange={(event) => toggle(scope, event.target.checked)}
                  />
                  <span className="min-w-0">{scopeLabel(scope)}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        {issues.scopes ? (
          <p id={scopesErrorId} className="text-sm text-destructive">
            {issues.scopes}
          </p>
        ) : null}
      </fieldset>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={expiryId} className="text-sm font-medium">
          {tokenText("expiry_label")}
        </label>
        <select
          id={expiryId}
          value={draft.expiresInDays === null ? "never" : String(draft.expiresInDays)}
          onChange={(event) =>
            setDraft({
              ...draft,
              expiresInDays:
                event.target.value === "never"
                  ? null
                  : (Number(event.target.value) as TokenDraft["expiresInDays"]),
            })
          }
          className="h-11 w-full max-w-xs rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring sm:text-sm"
        >
          {EXPIRY_CHOICES.map((days) => (
            <option key={days ?? "never"} value={days === null ? "never" : String(days)}>
              {tokenText(days === null ? "expiry_never" : `expiry_${days}`)}
            </option>
          ))}
        </select>
      </div>
      {problem ? <FormError>{problem}</FormError> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {tokenText(busy ? "creating" : "create_go")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tokenText("cancel")}
        </Button>
      </div>
    </form>
  );
}

/** The token, once: the API keeps only its hash and never shows it again. Copy takes focus. */
function TokenOnce({
  shown,
  onDismiss,
}: {
  shown: { token: string; name: string };
  onDismiss: () => void;
}) {
  const textId = useId();
  const hintId = useId();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [asking, setAsking] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => copyRef.current?.focus(), [shown.token]);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.token);
      setCopied(true);
      setManual(false);
      setAsking(false);
    } catch {
      setManual(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
      <div className="flex items-start gap-3">
        <div id={textId} className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-semibold [overflow-wrap:anywhere]">
            {tokenText("token_created", { name: shown.name })}
          </p>
          <p>{tokenText("token_once")}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-1.5 -mr-1.5"
          aria-label={m.dismiss()}
          aria-describedby={textId}
          onClick={() => (copied ? onDismiss() : setAsking(true))}
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          readOnly
          value={shown.token}
          aria-label={tokenText("token_label")}
          aria-describedby={manual ? hintId : textId}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 font-mono text-base outline-none focus-visible:ring-3 focus-visible:ring-ring sm:text-sm"
        />
        <Button ref={copyRef} onClick={() => void copy()}>
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {tokenText(copied ? "copied" : "copy")}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copied ? tokenText("copied") : ""}
      </span>
      {manual ? (
        <p id={hintId} className="-mt-1 text-muted-foreground">
          {tokenText(isApple() ? "copy_key_apple" : "copy_key")}
        </p>
      ) : null}
      {asking ? (
        <div className="flex flex-col gap-2 rounded-md bg-card p-3">
          <p className="font-medium">{tokenText("close_prompt")}</p>
          <div className="flex flex-wrap gap-2">
            <Button ref={keepRef} variant="outline" onClick={() => setAsking(false)}>
              {tokenText("keep_open")}
            </Button>
            <Button variant="ghost" onClick={onDismiss}>
              {tokenText("close")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isApple(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
  );
}

/** Epoch ms, refreshed every `ms`, so relative times move on their own. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
