# What this changes

<!-- One or two sentences. -->

## Does it move any published number?

<!--
Delete whichever does not apply.

- No, this does not touch any value on the site.
- Yes. Metric measured, value before, value after:
-->

If it does, the project's standard is a measurement against the previous state, not an
argument that the new behaviour is more reasonable. State what you measured and what it was
before and after — for example, mean rating drift against the last clean snapshot, or the
top ten before and after.

## Checks

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Both locales still render (`/es` and `/en`)

## If it touches data or methodology

- [ ] Every new value carries a `source_type` and a `measured_at`
- [ ] No value came from a language model
- [ ] `/methodology` updated if a rule changed
- [ ] Licence of any new source checked and recorded in `SOURCES.md`

## Anything you are unsure about

<!-- Genuinely useful. Say what you could not verify. -->
