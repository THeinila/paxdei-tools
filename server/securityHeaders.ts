/** Security headers, set by the app rather than the proxy.
 *
 * These are properties of the application, not of the deployment: the policy has
 * to change when the app starts loading something new, so it belongs next to the
 * code that would break it and in the same review. Caddy keeps only what is
 * genuinely transport-level (HSTS) plus compression.
 *
 * The app is fully self-hosted by design — game data is bundled and icons are
 * served locally, so it makes no external subresource requests at runtime (see
 * README). That means `default-src 'self'` costs nothing and is worth having. */
import type { MiddlewareHandler } from "hono";

/** `style-src` allows inline because the recipe tooltip positions itself with a
 * computed `style` attribute; that is a style-only relaxation and does not
 * loosen `script-src`, which is what actually matters for XSS. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nothing here should ever be framed; share tokens live in the URL.
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("Content-Security-Policy", CSP);
    c.header("X-Content-Type-Options", "nosniff");
    // Share tokens travel in the URL path, so keep them out of Referer on any
    // cross-origin navigation (outbound links also carry rel="noreferrer").
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    // Belt and braces alongside frame-ancestors, for anything that predates CSP.
    c.header("X-Frame-Options", "DENY");
  };
}

export const CONTENT_SECURITY_POLICY = CSP;
