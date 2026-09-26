# Public maintenance record

This file records reusable reliability work. It does not claim traffic lifts,
loss avoided, or adoption numbers that have not been measured.

## 2026-09-16 — credential-free demo and license split

- Added `LICENSE` (MIT) and `NOTICE` (shop media and identity are not licensed).
- Extracted `src/ossReliability.ts`: approval completeness, uncertain-commit
  retry refusal, and unmeasured analytics.
- Added `npm run oss-demo` and 25 targeted regression cases.
- Added English / Traditional Chinese onboarding and `docs/oss/` evidence page.

Verification: `npm run oss-demo` and `npm run test:oss`.

## Prior maintenance this demo is built on

These already existed in the production pipeline. They are listed as evidence
of active maintenance, not as work invented by the demo.

| Change | What it proved | Where |
|---|---|---|
| PR #66 | Lost publish responses must not be retried; unsupported offers must not ship | https://github.com/39211/laundry-social-auto-poster/pull/66 |
| PR #55 | Codex review-usage limit was recorded, not hidden | https://github.com/39211/laundry-social-auto-poster/pull/55 |
| PR #77 | GA4 / AI reports must not truncate or write a false zero | https://github.com/39211/laundry-social-auto-poster/pull/77 |
| PR #84 | Owner-confirmed luxury shoe case shipped only after failure-and-fix verification | https://github.com/39211/laundry-social-auto-poster/pull/84 |

Baseline for later funded work: 25 kernel cases, 3 named demo scenarios, and
the production suites already in `test/`. Review time and additional findings
should be added here when they exist — do not invent a savings percentage.
