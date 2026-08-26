# Security Policy

## Scope

ModelHub has no user accounts, no authentication, and no user-submitted data — that's a
hard constraint of the project (no auth in v1). Nothing here handles passwords, sessions,
or personal data beyond what a static site logs by default at the hosting layer.

The realistic attack surface is narrow:

- A dependency (`npm` or GitHub Actions) with a known vulnerability.
- A compromised or malicious upstream data source feeding bad values into the daily ingest
  (`scripts/ingest/`), which runs unattended in GitHub Actions and writes straight to `/data`.
- A bug in the ingest or enrichment scripts that could be tricked into writing something
  unintended, given a crafted upstream payload.

There is no paid infrastructure, no database, and no server-side code beyond the daily
ingest job and the Next.js build.

## Reporting a vulnerability

Open a [GitHub issue](https://github.com/DDamianZR/ModelHub/issues) for anything that
doesn't need to stay private before a fix ships. For something more sensitive — a
dependency CVE with a working exploit, or a way to get the ingest to write arbitrary
content into `/data` — use GitHub's private vulnerability reporting for this repository
(Security tab → "Report a vulnerability") if it's enabled, so it isn't public before
there's a fix.

This is a solo, student-maintained project with no fixed SLA. Reports get read and
triaged, but there's no guaranteed response time — please don't rely on this project for
anything where that isn't acceptable.

## Supported versions

There are no released versions to track — `main` is what's deployed. Fixes land there
directly rather than being backported anywhere.
