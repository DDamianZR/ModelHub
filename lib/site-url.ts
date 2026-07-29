/**
 * The origin this deployment publishes as its own identity, for canonical and hreflang.
 *
 * There is deliberately no fallback string. A canonical pointing at a URL somebody else
 * owns is not a cosmetic defect: it is an explicit instruction to search engines to
 * consolidate indexing on that page instead of this one. A hardcoded default is how that
 * happens, because it keeps working silently on every deployment that forgets to set the
 * variable. So either the origin is known, or the site declines to claim one at all —
 * an absent canonical is ignored, a wrong one is obeyed.
 *
 * Kept free of Node imports so it can be reasoned about like the rest of /lib.
 */

type Env = Record<string, string | undefined>;

/** Accepts a bare host or a full URL and returns a bare origin, or null if unusable. */
function toOrigin(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  // Vercel's system variables carry no protocol scheme; an explicitly configured one
  // usually does. Accept both rather than making the human remember which.
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the deployment origin, or null when nothing trustworthy is available.
 *
 * VERCEL_URL is deliberately not consulted. It names the individual deployment
 * (`my-site-a1b2c3.vercel.app`), so canonicalising to it would point every build at a
 * different, short-lived URL — a different way of getting the same thing wrong.
 */
export function resolveSiteOrigin(env: Env = process.env): string | null {
  return (
    toOrigin(env.NEXT_PUBLIC_SITE_URL) ??
    // Vercel documents this as the project's stable production domain, set even on
    // preview deployments. It is treated as best effort: if the project has system
    // environment variables switched off it will be missing, and that must surface as a
    // failed build rather than as a quietly wrong URL.
    toOrigin(env.VERCEL_PROJECT_PRODUCTION_URL)
  );
}

export const MISSING_ORIGIN_MESSAGE =
  "No deployment origin could be resolved. Set NEXT_PUBLIC_SITE_URL to this " +
  "deployment's own URL (Vercel: Project Settings > Environment Variables), or enable " +
  "system environment variables so VERCEL_PROJECT_PRODUCTION_URL is provided. " +
  "Refusing to build: canonical and hreflang tags would otherwise be omitted or, worse, " +
  "point somewhere this project does not own.";

const WARNING =
  "[metadata] No site origin resolved; canonical, hreflang and og:url are omitted from " +
  "this build. Set NEXT_PUBLIC_SITE_URL to emit them.";

// Both paths run once per prerendered page. Announcing once per worker process keeps the
// build log readable without hiding the message.
let announcedFailure = false;
let announcedWarning = false;

/**
 * Origin for metadata, failing the build when a deploy would otherwise ship without one.
 *
 * The failure is scoped to builds running on Vercel — including previews, because
 * VERCEL_PROJECT_PRODUCTION_URL is set there too, so a preview that cannot resolve an
 * origin is proof that production will not be able to either. Finding out on the pull
 * request is the point. A local `npm run build` and CI simply omit the tags.
 *
 * The message is written to stderr before throwing, not left to the exception. Next
 * redacts errors raised during a production render ("the specific message is omitted in
 * production builds"), so a bare throw fails the build while telling the maintainer
 * nothing about which variable to set — which is most of what this check is for.
 */
export function siteOriginForMetadata(env: Env = process.env): string | null {
  const origin = resolveSiteOrigin(env);
  if (origin) return origin;

  if (env.VERCEL) {
    if (!announcedFailure) {
      announcedFailure = true;
      console.error(`\n[metadata] ${MISSING_ORIGIN_MESSAGE}\n`);
    }
    throw new Error(MISSING_ORIGIN_MESSAGE);
  }

  if (!announcedWarning) {
    announcedWarning = true;
    console.warn(WARNING);
  }
  return null;
}
