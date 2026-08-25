/**
 * The deployment's own origin - used for canonical URLs, hreflang, the sitemap and the
 * OG image. Shared by layout.tsx, sitemap.ts, robots.ts and opengraph-image.tsx so the
 * fallback logic lives in exactly one place.
 *
 * Preference order: an explicit NEXT_PUBLIC_SITE_URL (set by a human in the Vercel
 * project's environment variables) beats VERCEL_PROJECT_PRODUCTION_URL (which Vercel
 * injects automatically at build time - useful, but it names *a* deployment, not
 * necessarily the domain a visitor actually typed if a custom domain is configured)
 * beats a local dev fallback.
 *
 * Never falls back to a hardcoded domain this project doesn't control. A wrong-but-
 * plausible URL is worse than an obviously-local one: nobody notices the first kind is
 * wrong, which is exactly what happened before this - every canonical tag on the live
 * site pointed at a domain nobody deployed to.
 */
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}
