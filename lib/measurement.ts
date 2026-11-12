/**
 * Visit counting and search-engine verification, both off until someone turns them on.
 *
 * The site counts page views with Vercel Web Analytics, loaded by a script tag so it adds
 * no dependency. Three decisions live here so the layout and /methodology cannot disagree
 * about them:
 *
 * 1. Nothing loads unless WEB_ANALYTICS=on and the build is the production deployment. A
 *    tag pointing at a route the project has not enabled is a 404 on every page, and a
 *    preview deployment is not a visit.
 * 2. The script is only ever loaded from this site's own origin. The path comes from the
 *    configuration Vercel passes at build time, with the documented default as fallback; a
 *    value that is not a same-origin path is ignored rather than trusted.
 * 3. The address reported for a view is the page's path and nothing else. The ranking
 *    keeps its search box and filters in the query string, so the full address carries
 *    what a reader typed. Measured with the vendor's debug script and no rule in place:
 *    typing in the search box reported no view, but returning to the page reported
 *    "/es?q=gpt". With the rule, the same steps report "/es".
 *
 * No Node imports. `process.env` is read at build time by the server components that call
 * this; nothing here reaches the browser except ANALYTICS_BOOTSTRAP.
 */

type Env = Record<string, string | undefined>;

/** The path Vercel serves the script from when no build-time configuration names another. */
export const DEFAULT_ANALYTICS_SRC = "/_vercel/insights/script.js";

/** A path on this origin ending in .js: one leading slash, no scheme, no host, no "..". */
function isSameOriginScript(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\/(?!\/)[\w\-./]+\.js$/.test(value) &&
    !value.includes("..")
  );
}

/** The script to load, or null when visits are not being counted. */
export function analyticsScriptSrc(env: Env = process.env): string | null {
  if (env.WEB_ANALYTICS !== "on" || env.VERCEL_ENV !== "production") return null;
  try {
    const configured = JSON.parse(env.VERCEL_OBSERVABILITY_CLIENT_CONFIG ?? "null")?.analytics
      ?.scriptSrc;
    if (isSameOriginScript(configured)) return configured;
  } catch {
    // Not JSON: fall through to the default rather than fail the build over a counter.
  }
  return DEFAULT_ANALYTICS_SRC;
}

/** The token for the search-console ownership tag, or null when none is set or it is malformed. */
export function googleSiteVerification(env: Env = process.env): string | null {
  const token = env.GOOGLE_SITE_VERIFICATION;
  return token && /^[\w-]{10,100}$/.test(token) ? token : null;
}

/**
 * Runs before the analytics script. It queues one rule: report the page's path without its
 * query string or fragment. If the address cannot be read, the view is dropped rather than
 * sent unfiltered.
 *
 * Written without the character pair "])": the layout's head is also serialised into the
 * page's inline payload, and scripts/audit-ux.mjs measures that payload up to the first
 * "])" it meets. The vendor's own snippet contains one and cut the measurement from about
 * 104 000 characters to 85 809, which would have let the payload grow unnoticed.
 */
export const ANALYTICS_BOOTSTRAP = `window.va=window.va||function(){var q=window.vaq=window.vaq||[];q.push(arguments)};window.va("beforeSend",function(e){try{var u=new URL(e.url,location.href);e.url=u.origin+u.pathname;return e}catch(x){return null}});`;
