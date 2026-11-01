# Run your own app and relay

For a company that runs its own Brigade instance and wants no third party on the paging path: it runs its own push
relay and builds its own Brigade app. Most instances do not need this: Freecorps' relay pages the store app, with no
build and no Apple or Google account ([Page your team with the Brigade app](phones.md)). The design is in
[RFC 0015](../rfcs/0015-any-instance-app.md) section 8.

**Only your own app build can be paged through your own relay.** Apple and Google deliver a push only when it is
signed with the keys of whoever published the app, so a relay holding your keys reaches only an app you built and
signed: your bundle id, App Group and extensions. The Brigade app from the stores can never be paged by it. Your
members install your build, which you publish yourself (App Store, Google Play, TestFlight, an MDM or an internal
store).

## What you need

- **An Apple Developer account**, with:
  - App IDs for the app and its two extensions (`<bundle id>`, `<bundle id>.NotificationService`,
    `<bundle id>.Widget`), the App Group `group.<bundle id>`, Push Notifications and VoIP (PushKit, for pages that
    ring as calls); Critical Alerts only if Apple grants them to you;
  - an **APNs key** for the relay: the `.p8` file (an EC P-256 key), its key id and your team id.
- **A Firebase project**, with an Android app for your package, its `google-services.json` for the build and a
  service account JSON for the relay (apps/relay README ["Setting up FCM"](../../apps/relay/README.md#setting-up-fcm)).
- **A bundle id** for both stores: two or more parts of letters and digits, each starting with a letter
  (`com.acme.brigade`; no `-`, which Android refuses, and no `_`, which Apple refuses).
- **A hostname for the relay** on a zone of the same Cloudflare account (`relay.acme.example`): phones and your
  instance reach it there.
- **An Expo account** for EAS (builds, credentials, store submissions), and App Store Connect and Google Play
  accounts to publish.

## 1. Set up the relay

From the repository root, logged in to wrangler on your instance's account:

```bash
vp run setup:relay
```

Choose **2, Your own relay**. The script says again that only your own build can be paged, asks for what it needs
(and stops, with nothing deployed, if any is missing or wrong), then:

1. Reads the relay Worker's secret names (never values). It refuses a `brigade-relay` Worker it did not set up
   (no `BRIGADE_OWN_RELAY` marker secret) unless you pass `--take-over-relay`.
2. Builds `apps/relay` and sets its secrets: your APNs key, key id and team id and the Firebase service account
   (`APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `FCM_SERVICE_ACCOUNT`), `RELAY_APNS_TOPIC` (your bundle id),
   `RELAY_CLOSED=1` (registration closed to everyone but your instance), the marker `BRIGADE_OWN_RELAY`, a
   one-time `RELAY_ADMIN_TOKEN` and, when the relay has none yet, the handle and tag keys (`RELAY_HANDLE_KEYS`,
   `RELAY_TAG_KEY`) and `RELAY_SEND_TOKEN`. A relay's APNs and Firebase credentials are kept unless you ask to
   replace them (`--replace-credentials`).
3. Deploys it as `brigade-relay` (`brigade-relay-dev` with `--env dev`; the relay has no staging) with your hostname
   as its custom domain, and waits for the domain (at most 5 minutes).
4. Registers your instance with the admin token: no terms, no emailed code. Then deletes the admin token, so nothing
   else can register.
5. Sets on the API Worker `RELAY_INSTANCE_KEY`, `RELAY_URL` (`https://<your hostname>`), `RELAY_SEND_TOKEN` (the
   same as the relay's), `RELAY_KIND=own` (what tells the dashboard this is your own relay) and, if you gave one,
   `RELAY_APP_URL`, your app's store link.
6. Runs the relay's signed deep health check.

Then **build and deploy the API again**: its production build already binds `RELAY` to `brigade-relay`
(`apps/api/vite.config.ts`, `PRODUCTION_BINDINGS`), so pages go Worker to Worker. Keep the instance key the script
saved (`~/.config/brigade/relay-instance-key-…`) in a password manager, then delete the file.

Without a terminal, every answer is a flag:

```bash
vp run setup:relay -- --relay own --apns-key-file ~/keys/AuthKey_XXXXXXXXXX.p8 --apns-key-id XXXXXXXXXX \
  --apns-team-id XXXXXXXXXX --bundle-id com.acme.brigade --fcm-service-account-file ~/keys/fcm.json \
  --relay-domain relay.acme.example --app-url https://apps.apple.com/…
```

`--app-url` is optional. With it, `GET /config` gives it to the app as `relay.app`, and the dashboard's "Use the app"
page shows members "Get your company's app"; without it, it tells them to ask an owner or admin. Every step and flag
is in the apps/api README, ["Push relay"](../../apps/api/README.md#push-relay).

## 2. Build your app

The app's identifiers and servers are build variables, so you build from this repository without editing it
(`apps/mobile`, Expo with EAS):

| Variable                        | What                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRIGADE_APP_ID`                | Your bundle id and Android package (`app.freecorps.brigade` when unset). Everything else follows it: the App Group `group.<BRIGADE_APP_ID>`, written into each target's entitlements and Info.plist, and the extensions' bundle ids. It must be the `--bundle-id` you gave the setup script.   |
| `EXPO_PUBLIC_BRIGADE_URL`       | Your dashboard's origin (`https://brigade.acme.example`): the instance the app signs in to by default.                                                                                                                                                                                         |
| `EXPO_PUBLIC_BRIGADE_RELAY_URL` | Optional: the relay this build is paged through. Unset, the build takes the relay your instance's `/config` names (`relay.origin`, from `RELAY_URL`), which is your relay: most builds leave it unset. Only a build whose default instance is Freecorps' hosted Brigade uses Freecorps' relay. |
| `GOOGLE_SERVICES_FILE`          | The path of your Firebase `google-services.json` (on EAS, a file environment variable of that name). Without it the app builds with no Android pages.                                                                                                                                          |
| `BRIGADE_CRITICAL_ALERTS`       | `1` once Apple has granted you Critical Alerts; leave it unset until then, or the build fails on its profile.                                                                                                                                                                                  |
| `APPLE_TEAM_ID`                 | Your Apple team id, for local builds signed by Xcode.                                                                                                                                                                                                                                          |

For EAS builds, set them as environment variables of each build profile. In your copy, point `app.config.ts`'s
`owner`, EAS project id and update URL at your own Expo account (`eas init`), and `eas.json`'s `submit` at your own
App Store Connect and Google Play accounts. Local builds read the same variables from the shell:

```bash
BRIGADE_APP_ID=com.acme.brigade EXPO_PUBLIC_BRIGADE_URL=https://brigade.acme.example vp run mobile:build
BRIGADE_APP_ID=com.acme.brigade vp run mobile:install --clean   # on a phone; --clean after changing the id
```

The first EAS build of a new bundle id needs its iOS credentials once, interactively (`eas credentials -p ios`). The
apps/mobile README has the details: ["On a phone, and builds for distribution"](../../apps/mobile/README.md#on-a-phone-and-builds-for-distribution)
and ["Your own app"](../../apps/mobile/README.md#your-own-app).

Your build pages only the instances whose `/config` names its relay. Members can still add other instances to it,
but one on another relay (Freecorps', say) stops with "This instance uses its own app build", and the store app does
the same with yours, linking to your app ("Get your company's app") when you set `RELAY_APP_URL`.

## 3. Check it works

Workspace settings, **"Phones and pages"**: "Pages go through your company's own relay (relay.acme.example)", its
state from the paging self-check, and your app's link. The states and what to do about each are in
[Page your team with the Brigade app](phones.md#when-it-is-not-working); on your own relay, the fix is yours rather
than Freecorps', and the card shows the command when one fixes it.

## Keeping it

- **Redeploying the relay keeps its settings.** The topic and closed registration are secrets
  (`RELAY_APNS_TOPIC`, `RELAY_CLOSED`), so a later `wrangler deploy` of `apps/relay` with no flags, by hand or from
  CI, keeps them, as it keeps every other secret.
- **Running the script again** keeps the relay's handle and tag keys (new ones would void every phone's handle) and
  its APNs and Firebase credentials, unless you pass `--replace-credentials`. Pass `--instance-key-file` with your
  saved key, or the instance gets a new id and every phone has to open the app once to be paged again; and never
  after a key rotation, since installing a key removes `RELAY_INSTANCE_ID`
  ([Rotating the instance key](phones.md#rotating-the-instance-key)). The topic follows `--bundle-id` on every run.
- **Changing the bundle id moves pages to another app.** The relay's topic becomes the new id, so the app with the
  old id is no longer paged: every member installs the new build and signs in again.
- **An own relay set up before `RELAY_KIND` existed**, with no app link, shows on the dashboard as Freecorps' relay:
  set only that secret (`wrangler secret put RELAY_KIND` in `apps/api`, value `own`). Do not run the script again for
  this.
- **Switching to Freecorps' relay** later (`vp run setup:relay`, choice 1) gives the instance a new key and id and
  removes `RELAY_KIND`, `RELAY_APP_URL` and your relay's `RELAY_SEND_TOKEN` from the API. Your members then need the
  store app; your own build is no longer paged.
