> **Template — preliminary version, not in effect.**
> This is a draft of the terms for Freecorps' hosted push relay, written so self-hosted instances have something to
> read and point at while the relay is built. It has not been reviewed by counsel, it binds no one, and it will be
> replaced by the final text (on the project's site) before any instance is told to use the hosted relay. Bracketed
> parts (`[…]`) are still to be filled in. Version: `draft-2026-11`.
>
> Portuguese: [relay-terms.pt-BR.md](relay-terms.pt-BR.md).

# Terms of service of the Brigade push relay

These terms cover the push relay that Freecorps Tecnologia da Informação LTDA ("Freecorps", "we") runs for Brigade instances ("the
relay"). They apply to whoever runs an instance and registers it with the relay ("you"). The Brigade software
itself is under its own open-source licenses (AGPL-3.0 and MIT); these terms are about the service only.

## 1. What the relay does

Apple (APNs) and Google (FCM) deliver notifications only from whoever publishes an app. The relay lets an instance
you run page the Brigade app from the App Store and Google Play: your instance sends it a sealed notification and an
opaque handle, and the relay passes it to Apple or Google.

The relay cannot read your notifications. They are encrypted on your instance for each phone and opened only on that
phone (RFC 0006). The relay sees the handle, the ciphertext, the urgency and the time.

## 2. Registering

- To use the relay you register your instance, accept these terms and give a contact address that you confirm by
  email. We write to that address about your use of the relay, including before we limit or suspend it.
- Your instance's key is its credential. Keep it safe: whoever holds it can send as your instance, and if you lose it
  every phone must open the app again before it is paged.
- One registration per instance. You are responsible for what is sent with your instance's key.

## 3. Price and fair use

The relay is free for any registered instance within these limits, which are well above what a real team pages:

- 600 notifications a minute per instance, of which at most 60 calls;
- 30 notifications a minute to any one phone.

We can raise them on request. Sending past them is refused (`429`), not billed.

## 4. What you must not do

- Send anything that is not about your team's incidents, alerts, on-call or the app's own state: no marketing, no
  bulk messages, no notifications for third parties.
- Send calls (VoIP pushes) or Critical Alerts for anything less than a page.
- Try to reach phones that did not sign in to your instance, to read other instances' traffic, or to get around the
  limits (for example with many registrations).
- Resell the relay, or build a paid service on it, without a written agreement with Freecorps.
- Use it against the law or against Apple's or Google's rules for push notifications.

Breaking these rules can get the whole app throttled by Apple or Google, for every Brigade user. That is why we act
on them (section 7).

## 5. What we see and keep

- **About your instance:** its id and public key, the terms version you accepted, your contact address, and counts
  of what it sent (per minute, kept [30 days]).
- **About phones:** when a phone asks for a handle, its push token (sealed inside the handle, never stored by us
  separately) and its IP address (in logs kept [7 days]).
- **About notifications:** the handle, the urgency, the time and Apple's or Google's answer, in logs kept [7 days].
  Never their content, which we cannot read.

We do not sell any of it or use it for advertising. We use it to run the relay, to enforce these terms and to answer
legal requests. [Freecorps' privacy policy and data protection contact, LGPD/GDPR.]

## 6. Availability

We run the relay with care, but we give **no guarantee** that it is available or that any notification arrives:
Apple, Google, the network and the phone are all on the way. Do not make it the only way your team is reached. A
Brigade instance can also page by email, and you can run your own relay with your own app build instead (the
self-host docs explain how).

We tell registered contacts ahead of planned maintenance when it may delay notifications, and we keep a status page
at [address].

## 7. Limiting, suspending and ending

- We can limit or suspend an instance that breaks section 4 or puts the relay or the app at risk. Unless the harm is
  ongoing, we write to the contact address first and give you [7 days] to fix it.
- You can stop using the relay at any time; ask us at [address] to delete your registration.
- We can stop offering the relay with [90 days'] notice to every registered contact.

## 8. Changes to these terms

We publish each new version with its date. For changes that reduce what you get or add obligations, we write to the
contact address [30 days] before they apply; using the relay after that means you accept them.

## 9. Liability

The relay is provided as is, free of charge. To the extent the law allows, Freecorps is not liable for notifications
that were delayed, lost or not sent, nor for what follows from them. [Limitation and jurisdiction clauses, to be
written with counsel; governing law: Brazil, courts of [city].]

## 10. Contact

[contact address for the relay]
