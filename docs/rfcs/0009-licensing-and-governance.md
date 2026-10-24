# RFC 0009 — Licensing and governance

- Status: Draft — **requires review by Freecorps' legal counsel before the first external contribution**

## Licenses

| Part                                                    | License       | Reason                                                                        |
| ------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `apps/*`, `integrations/*` (server, relay, web, mobile) | AGPL-3.0-only | Anyone offering Brigade as a network service must publish their modifications |
| `packages/*` (schema, sync, sdk, i18n, ui)              | MIT           | Integrations and SDK users are not forced into AGPL                           |
| Docs                                                    | CC BY 4.0     | Standard for documentation                                                    |

AGPL does not forbid commercial hosting; it removes the incentive to build closed forks. Source-available
alternatives (FSL, BSL) were considered and rejected to keep Brigade genuinely open source.

## Contributor License Agreement

Contributors sign a CLA granting Freecorps the right to relicense their contributions. Needed for:

1. **App Store / Play Store distribution** of the AGPL mobile app (store terms are generally considered incompatible
   with (A)GPL when distributed by someone who doesn't hold all the copyright).
2. **Dual licensing** (commercial license for companies that cannot use AGPL).
3. Future flexibility.

Tooling: CLA Assistant (GitHub app). CLA text: base on a standard individual/corporate CLA (e.g. Apache ICLA/CCLA),
reviewed by counsel. Until then, **no external contributions are merged**.

## Trademark

"Freecorps" is filed at INPI (classes 09, 35, 42). File "Freecorps Brigade" in the same classes. A trademark
policy (`TRADEMARKS.md`) allows forks but not use of the name/logo for modified versions or hosted services.

## Hosted relay

See RFC 0006 — the official push relay has its own terms of service.
