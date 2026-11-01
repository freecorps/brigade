# Page your team with the Brigade app

For someone running their own Brigade instance. This is the default way to page phones: your instance sends its
pages through **Freecorps' relay**, and your team uses the **Brigade app from the App Store and Google Play**. You
build no app and need no Apple or Google account. The design is in
[RFC 0015](../rfcs/0015-any-instance-app.md) and [RFC 0006](../rfcs/0006-push-relay.md); the reference for every
flag is the apps/api README, ["Push relay"](../../apps/api/README.md#push-relay).

If your company must have no third party on the paging path, read
[Run your own app and relay](own-app.md) instead.

> **What works today.** The relay, `vp run setup:relay`, the dashboard's "Phones and pages" and "Use the app", and
> the app's side (several instances, adding one by address or QR code, QR sign-in, which relay an instance uses) are
> built. Three things stand between a store-app phone and a page from your instance through Freecorps' relay:
>
> 1. **A store release of the app with these changes.** The Brigade app is not in the stores yet (roadmap Phase 4).
>    Builds released so far register raw device tokens, which Freecorps' relay accepts only from Freecorps' own
>    instance, so they are never paged by yours.
> 2. **The relay's final terms.** Today's are a draft, not in effect (see [The terms](#the-hosted-relays-terms)):
>    Freecorps' relay is not offered to self-hosters until the final text is published.
> 3. **Your instance registered with the relay** ([Set it up](#set-it-up)).
>
> Until then pages reach people by email, if the API can send email (`EMAIL_FROM`, apps/api README
> ["Email"](../../apps/api/README.md#email)).

## How it works

1. Your instance has its own key pair. The private key is the API secret `RELAY_INSTANCE_KEY`; the instance id
   (`ins_…`) comes from the public key. Every call your instance makes to the relay is signed with it. There is no API
   key to copy or leak.
2. The instance registers once with the relay: it accepts the relay's terms and gives a contact address, confirmed by a
   code the relay emails to it.
3. A member's phone asks the relay for a **handle**: its push token sealed by the relay, bound to your instance. The
   phone registers the handle with your instance. Your instance never sees a phone's APNs or FCM token.
4. For a page, your instance seals the page for the phone (end to end) and sends it with the handle to the relay,
   which hands it to Apple or Google.

## Set it up

From the repository root, logged in to wrangler (`wrangler login`, or `CLOUDFLARE_API_TOKEN`) on the account your
instance runs on:

```bash
vp run setup:relay
```

Choose **1, Freecorps' relay (recommended)**. The script:

1. Shows the terms' address and version (`draft-2026-11`) and asks you to accept them. Nothing is made or sent before
   you do.
2. Asks for a **contact address**. Freecorps writes to it about your instance, and before limiting or revoking it.
3. Checks it can reach the relay (`https://relay.brigade.freecorps.com.br`). If it cannot, it stops with "Could not
   reach the relay" and has changed nothing.
4. Makes the **instance key** and saves it outside the repository, readable only by you
   (`~/.config/brigade/relay-instance-key-<worker>-<instance id>`, or `--key-out <path>`).
5. Has the relay email a **6-digit code** to the contact address (valid 15 minutes, 5 tries, at most 3 codes an hour)
   and asks for it.
6. Registers the instance with the relay (`POST /v1/instances`).
7. Sets `RELAY_INSTANCE_KEY` and `RELAY_URL` on the API Worker. Secret values go to wrangler on stdin, never in a
   command's arguments, on the screen or in a file in the repository.
8. Runs the relay's signed deep health check and reports that the relay is **reachable and this instance is
   registered**. That is not yet proof that pages reach phones (next step).

Then, **required, or no phone is paged:**

- **Remove the API's `RELAY` service binding** and deploy the API again. The production build binds `RELAY` to a
  relay Worker on your own account (production: `apps/api/vite.config.ts`, `PRODUCTION_BINDINGS`; `dev`: `services`
  in `apps/api/wrangler.jsonc`; `staging` has none), and the API sends through that binding before `RELAY_URL`. That relay
  does not know your instance. The script reads those files and says whether the binding is there. The one binding it
  leaves alone is Freecorps' own production instance's: registered at the default address, with `brigade-relay` a
  Worker on the same account that the script did not set up, the hosted relay itself, so the binding reaches the
  relay the instance just registered with. On your account, remove it even when the name is the same: a `brigade-relay` you
  deployed by hand looks the same to the script, which then says the binding stays only on Freecorps' account.
- **Keep the instance key in a password manager**, then delete the file. If it is lost, your instance gets a new id,
  and every phone has to open the app once before it is paged again.

`--env dev` or `--env staging` sets up the Workers of that environment (default: production). Without a terminal,
every answer is a flag and registration takes two runs, the first sending the code:

```bash
vp run setup:relay -- --relay freecorps --accept-terms draft-2026-11 --contact oncall@example.com
vp run setup:relay -- --relay freecorps --accept-terms draft-2026-11 --contact oncall@example.com \
  --instance-key-file ~/.config/brigade/relay-instance-key-… --code 123456
```

`--instance-key-file` also finishes a run that stopped (a code that expired, a secret wrangler could not set) with the
same key and id. `vp run setup:relay -- --help` lists every flag.

**Running it again** when the API already has `RELAY_INSTANCE_KEY` makes a new key and id unless you pass
`--instance-key-file`: every phone would have to open the app once to be paged again. The script asks before it does
(`--yes` skips the question). Installing a key also removes `RELAY_INSTANCE_ID`, so never run it again after a key
rotation ([Rotating the instance key](#rotating-the-instance-key)).

## Limits

Freecorps' relay is shared by every instance that uses it, and an instance flooding Apple can get the whole app
throttled for everyone. So each instance has limits, well above any real incident and raised on request (RFC 0015
decision D4):

| What                                   | Limit        |
| -------------------------------------- | ------------ |
| Pushes from one instance               | 600 a minute |
| Calls (pages that ring), on top        | 60 a minute  |
| Pushes to one phone, from one instance | 30 a minute  |

A page is never exempt. A push over a limit is refused with `429` and `Retry-After: 60`; your instance tries again
after that wait. The limits are counted per Cloudflare location, so they are approximate.

## How your team gets the app

Each member opens the dashboard's **"Use the app"** page (`/use-the-app`, linked from their account page). It says
which app to install (the store app on Freecorps' relay, your company's build on your own relay) and shows the QR
codes. Then, on the phone:

1. **Install** the Brigade app from the App Store or Google Play.
2. **Add your instance:** "Another instance" on the sign-in screen (or "Add an instance" in the Account tab, for a
   phone already signed in somewhere), then type the dashboard's address (`brigade.example.com`) or tap **"Scan a QR
   code"**. The app reads the instance's `/api/config` and refuses an address that is not HTTPS or not a Brigade
   ("This address is not a Brigade instance"), an instance that pages through another app ("This instance uses its
   own app build"), and one that needs a newer app ("Update the app"). An instance with no relay can be signed in to,
   with "This instance cannot page this phone". Before anyone types a password, the app names the host in full
   ("You are signing in to brigade.example.com").
3. **Sign in**, with email and password, or with **"Sign in with a QR code"** on the "Use the app" page: the member
   scans that code in the app (it lives 2 minutes and works once), confirms "Sign in to brigade.example.com?", and
   the phone shows a **2-digit number** ("Type this number on the dashboard"), which the member types on the
   dashboard. The dashboard never shows the number, so a photo of the code alone signs nobody in, and one wrong
   number ends the sign-in. "Only the address" on the same page is a QR code that adds the instance without signing
   in. A `brigade://connect` link opened from outside the app (the system camera, say) first asks "Connect to
   brigade.example.com?".
4. **Allow notifications.** The app asks the relay for a handle and registers the phone with your instance. The
   Account tab says whether this phone is paged, and each instance's "About this instance" sheet says which relay it
   pages through ("Pages go through Freecorps' relay").

One phone can be signed in to several instances (at most 5) and is paged by all of them; the Account tab lists each
with its workspaces and paging state, and "Remove from this phone" signs out of one.

## Check it works

- **"Phones and pages"**, in the workspace settings (`/settings`, owners and admins), says which relay pages go
  through ("Pages go through Freecorps' relay") and its **state**, from the last paging self-check.
- **The paging self-check** (the watchdog, apps/api README ["Dead-man switch"](../../apps/api/README.md#dead-man-switch))
  runs every minute. With `RELAY_INSTANCE_KEY` set it asks the relay's signed `GET /v1/health?deep=1`: the relay
  checks your instance's signature and registration, and its own Apple and Google credentials, without sending a
  push. Its reasons show on "Phones and pages" and as a notice on the overview, and every change is emailed to the
  operators (`OPERATOR_EMAILS`).
- **"Working"** means the last check reached the relay and it answered. To see a real page arrive, declare a SEV1 or
  SEV2 test incident with someone on call whose phone is registered.

## When it is not working

The state on "Phones and pages", the watchdog's reason behind it, and what to do:

| State                | Reason                        | What to do                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refused              | `relay_bad_signature`         | The relay does not accept your instance's key, or the server's clock is more than 5 minutes off. Check that `RELAY_INSTANCE_KEY` is the key you saved and, after a key rotation, that `RELAY_INSTANCE_ID` is the instance's first id. **Do not run `vp run setup:relay` again for this:** it makes a new instance id, and every phone would have to open the app again. |
| Not registered       | `relay_instance_unregistered` | Your instance is not registered on the relay, or its registration was not finished (it needs the emailed code). Run `vp run setup:relay` again, with `--instance-key-file` to keep the key you have.                                                                                                                                                                    |
| Refused              | `relay_instance_revoked`      | Freecorps revoked your instance on its relay. Write to Freecorps to find out why before registering again; registering again first only gets it revoked again.                                                                                                                                                                                                          |
| Rate limited         | `relay_rate_limited`          | The relay refused your instance's checks as over its limits on three checks in a row. It usually clears on its own (instances on Workers may share Cloudflare's addresses, and the check is limited per address); if it lasts, ask Freecorps to raise the limit.                                                                                                        |
| Handles unavailable  | `relay_handles_unavailable`   | The relay cannot open phone handles right now, so phones registered with one are not paged. If it lasts, write to Freecorps.                                                                                                                                                                                                                                            |
| Unreachable          | `relay_unreachable`           | The relay does not answer. Check `RELAY_URL` on the API (`https://relay.brigade.freecorps.com.br`) and that the API has no `RELAY` binding; if both are right, the relay may be down, and pages go out by email meanwhile.                                                                                                                                              |
| Push service failing | `apns_failing`, `fcm_failing` | Apple's or Google's push service refused the relay's credentials or does not answer. That is on the relay's side: nothing to change on your instance.                                                                                                                                                                                                                   |

And in the app, **"This instance uses its own app build"** when adding it (or "Not paged here: it uses its own app"
in the Account tab): the instance's `/api/config` names another relay than the app's, so its pages can never reach
this app (an instance on its own relay, with its own app build; or a `RELAY_URL` that is not Freecorps' relay's
address exactly). The app registers nothing there. Install the company's app, or, if your instance is meant to use
Freecorps' relay, set `RELAY_URL` to `https://relay.brigade.freecorps.com.br`. **"This instance cannot page this
phone"** means its `/api/config` has no relay: `RELAY_INSTANCE_KEY` or an https `RELAY_URL` is missing on the API.

Other states ("Held up in Brigade", "Database not answering", "Couldn't check") are Brigade's own pipeline, not the
relay's: the overview's paging notice says why.

## Rotating the instance key

The instance id comes from the first key and never changes: every handle on every phone is sealed for it. To replace
a key that may have leaked, without phones having to open the app again (there is no command for this yet):

1. Add the new key on the relay: `POST /v1/instances/keys` with `add` (the new public key) and `proof` (the new key's
   signature over the instance id, `signKeyProof` in `packages/push`), signed with the current key (apps/relay
   README ["Instance registration"](../../apps/relay/README.md#instance-registration); at most 3 keys).
2. On the API, set the new key as `RELAY_INSTANCE_KEY` **and** the first id as `RELAY_INSTANCE_ID` (`ins_…`, the
   `relay.instance` your dashboard's `/api/config` showed before). Without `RELAY_INSTANCE_ID` the API would sign as
   the id the new key gives, for which no handle was sealed, and every page would be refused.
3. Deploy, check "Phones and pages" says "Working", then retire the old key on the relay (`retire`, signed with the
   new key).

Do not run `vp run setup:relay` after a rotation: installing a key removes `RELAY_INSTANCE_ID`. A key lost without
a rotation means a new instance id: every phone has to open the app once to be paged again.

## What the relay can and cannot see

- **It cannot read pages.** Your instance seals each page for the phone with HPKE, to a key that never leaves the
  phone (RFC 0006). The relay carries a ciphertext.
- **The sealed page says who sent it** (envelope version 2, RFC 0015 section 4): the instance's origin, the time,
  when it expires and its urgency are inside the sealed part. The phone opens a page only with the key it holds for
  that instance, only if it is signed in there, and only before it expires; anything else shows a generic
  notification and sends nothing back. So neither the relay nor another instance can make up a page that opens as
  yours, or replay an old one once it has expired (a page lives 15 minutes, a call 60 seconds). Receipts and the Acknowledge go only to your instance.
- **What it sees:** your instance's id, public key and contact address, counts of what it sent; for each push, the
  handle, the urgency, the time and Apple's or Google's answer; and the IP address of a phone when it asks for a
  handle. Inside a handle, the relay has the phone's push token, since it must give it to Apple or Google.
- **What it can do:** delay or drop a push, and set how loud a push that does not open is shown (with the generic
  text). That is why
  your instance keeps paging the next person on call when nobody acknowledges, and why email stays as a fallback.

## The hosted relay's terms

Registering on Freecorps' relay means accepting its terms: free for any instance within the limits; a paid service
built on it needs an agreement with Freecorps (RFC 0015 decision D5). The text is in
[docs/legal/relay-terms.md](../legal/relay-terms.md) ([pt-BR](../legal/relay-terms.pt-BR.md)), version
`draft-2026-11`.

**It is a draft, not in effect.** It has not been reviewed by counsel and binds no one. The final text replaces it on
the project's site before self-hosters are pointed at Freecorps' relay, with a new version that the setup script will
ask you to accept.
