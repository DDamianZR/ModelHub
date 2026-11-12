/**
 * lib/measurement.ts: when the visit counter loads, where from, and what it is allowed to
 * report. Run with `npm run test:fit` (node:test, no dependencies).
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  ANALYTICS_BOOTSTRAP,
  DEFAULT_ANALYTICS_SRC,
  analyticsScriptSrc,
  googleSiteVerification,
} from "../lib/measurement.ts";

const ON = { WEB_ANALYTICS: "on", VERCEL_ENV: "production" };

test("off by default, off on previews, off without the switch", () => {
  assert.equal(analyticsScriptSrc({}), null);
  assert.equal(analyticsScriptSrc({ WEB_ANALYTICS: "on", VERCEL_ENV: "preview" }), null);
  assert.equal(analyticsScriptSrc({ WEB_ANALYTICS: "on" }), null);
  assert.equal(analyticsScriptSrc({ VERCEL_ENV: "production" }), null);
  assert.equal(analyticsScriptSrc({ WEB_ANALYTICS: "true", VERCEL_ENV: "production" }), null);
});

test("on: the documented default when no build configuration names a path", () => {
  assert.equal(analyticsScriptSrc(ON), DEFAULT_ANALYTICS_SRC);
  assert.equal(
    analyticsScriptSrc({ ...ON, VERCEL_OBSERVABILITY_CLIENT_CONFIG: "not json" }),
    DEFAULT_ANALYTICS_SRC,
  );
  assert.equal(
    analyticsScriptSrc({ ...ON, VERCEL_OBSERVABILITY_CLIENT_CONFIG: '{"analytics":{}}' }),
    DEFAULT_ANALYTICS_SRC,
  );
});

test("on: a configured same-origin path is used", () => {
  const config = JSON.stringify({ analytics: { scriptSrc: "/a1b2c3/script.js" } });
  assert.equal(
    analyticsScriptSrc({ ...ON, VERCEL_OBSERVABILITY_CLIENT_CONFIG: config }),
    "/a1b2c3/script.js",
  );
});

test("on: a path that leaves this origin is ignored, never loaded", () => {
  for (const scriptSrc of [
    "https://example.com/script.js",
    "//example.com/script.js",
    "/a/../../script.js",
    "/a/script.js?x=1",
    "javascript:alert(1)",
    "/a/script.css",
    42,
  ]) {
    const config = JSON.stringify({ analytics: { scriptSrc } });
    assert.equal(
      analyticsScriptSrc({ ...ON, VERCEL_OBSERVABILITY_CLIENT_CONFIG: config }),
      DEFAULT_ANALYTICS_SRC,
      String(scriptSrc),
    );
  }
});

test("verification token: passed through when well formed, dropped otherwise", () => {
  assert.equal(googleSiteVerification({}), null);
  assert.equal(googleSiteVerification({ GOOGLE_SITE_VERIFICATION: "short" }), null);
  assert.equal(googleSiteVerification({ GOOGLE_SITE_VERIFICATION: 'abc"><script>xyz123' }), null);
  assert.equal(
    googleSiteVerification({ GOOGLE_SITE_VERIFICATION: "Abc123_def-456GHI789jkl" }),
    "Abc123_def-456GHI789jkl",
  );
});

/** Run the bootstrap in a bare context and hand back the rule it queued. */
function queuedRule(href: string): (event: { url: string }) => { url: string } | null {
  const window: Record<string, unknown> = {};
  vm.runInNewContext(ANALYTICS_BOOTSTRAP, { window, location: { href }, URL });
  const queue = window.vaq as Array<ArrayLike<unknown>>;
  assert.equal(queue.length, 1);
  assert.equal(queue[0][0], "beforeSend");
  return queue[0][1] as (event: { url: string }) => { url: string } | null;
}

test("bootstrap: free of the pair that ends the audit's payload measurement early", () => {
  assert.equal(ANALYTICS_BOOTSTRAP.includes("])"), false);
});

test("bootstrap: the query string and fragment are never reported", () => {
  const rule = queuedRule("https://site.example/es");
  const sent = rule({ url: "https://site.example/es?q=what+someone+typed&price=3#top" });
  assert.deepEqual(sent, { url: "https://site.example/es" });
});

test("bootstrap: the rule only rewrites the address, it never decides what counts", () => {
  const rule = queuedRule("https://site.example/es");
  // Which navigations are views is the script's call; the same path twice passes twice.
  assert.deepEqual(rule({ url: "https://site.example/es?q=g" }), { url: "https://site.example/es" });
  assert.deepEqual(rule({ url: "https://site.example/es?q=gp" }), { url: "https://site.example/es" });
  assert.deepEqual(rule({ url: "https://site.example/es/model/x?from=home" }), {
    url: "https://site.example/es/model/x",
  });
});

test("bootstrap: a relative address resolves against the page, an unreadable one is dropped", () => {
  const rule = queuedRule("https://site.example/es/compare?m=a,b");
  assert.deepEqual(rule({ url: "/es/local?mem=16" }), { url: "https://site.example/es/local" });
  assert.equal(rule({ url: "http://[" }), null);
});
