# 0012. Set security headers in the app with a strict same-origin CSP
Status: Accepted · Date: 2026-11-03
Backfilled from: `server/securityHeaders.ts`, `deploy/Caddyfile`

## Context
The app is exposed to the internet, with share tokens in the URL. It loads nothing from
other origins ([0003](0003-bundle-the-game-data-and-serve-every-asset-from-our-own-orig.md)),
so a strict policy costs nothing. The question is where the headers live. Spec: serving
(SRV).

## Decision
`securityHeaders()` middleware sets these headers on every response:
- a CSP with `'self'` for scripts, connections, fonts and the default; `img-src 'self'
  data:`; `object-src 'none'`; `base-uri`/`form-action 'self'`; and
  `frame-ancestors 'none'`;
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and
  `X-Frame-Options: DENY`.

`style-src` also allows `'unsafe-inline'`, because the recipe tooltip positions itself with a
computed `style` attribute. That relaxes styles only; `script-src` stays strict. Caddy sets
only HSTS, which is about transport.

## Consequences
- The policy sits next to the code that would break it, and changes to it are reviewed with
  that code.
- Anything new that loads from another origin (fonts, analytics, a CDN) needs a CSP change
  in the same commit.
- Inline styles are allowed everywhere, not only for the tooltip.

## Alternatives considered
- Setting headers in Caddy — rejected because the policy is a property of the app, and
  setting them in both places would send every header twice.
- A nonce or hash for styles — not chosen (unverified). The tooltip's style is computed at
  runtime.
