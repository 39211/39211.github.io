# Getting started (credential-free)

This repository is the publishing automation for a neighbourhood laundry shop.
You can evaluate the reliability rules without Meta, GA4, LINE, or any live
credential.

## What this demo proves

Three production rules, replayed against a fake merchant and a mock platform:

1. **Unapproved work cannot publish.** Missing, forced, paused, or fingerprint-mismatched consent never reaches the mock publisher.
2. **Retry cannot duplicate a post.** A lost response after the commit point is `uncertain` and is not retried.
3. **Missing analytics is not zero.** Unconfigured, failed, or empty reads stay `unmeasured` and keep the numeric field absent.

These rules are extracted from `src/approvePost.ts`, `src/postCurrentSlot.ts`,
`src/retry.ts`, `src/postInstagram.ts`, `src/postFacebook.ts`, and
`src/ga4Report.ts`. The demo does not rewrite that pipeline.

## Run from a clean checkout

Requires Node.js 22.5 or newer.

```bash
node oss-demo.mjs
```

`node oss-demo.mjs` prints the three named scenarios and the 25 targeted
regression cases. It never reads `.env` and never opens a network socket.

## Browser demo

After the public site is generated or served, open:

- `index.html` in this folder

or, on the GitHub Pages mirror:

- `https://39211.github.io/oss/`

The page runs the same 25 cases in the browser against mock data.

## Diagnose a failure

| Symptom | Likely cause | What to inspect |
|---|---|---|
| Scenario 1 does not block | Approval gate skipped | `evaluateApproval()` and case `A01` |
| Scenario 2 creates two remote ids | Uncertain retry was treated as failed | `publishDraft()` + cases `R01`–`R02` |
| Scenario 3 reports `value: 0` | Unmeasured coerced to zero | `recordAnalytics()` + cases `M01`–`M07` |
| `oss-demo` exits 1 | A regression case failed | The `[FAIL]` line in the CLI output |

Do not point the demo at a real Page, IG account, or GA4 property. If a command
asks for `META_ACCESS_TOKEN`, you have left the credential-free path.

## What is not in this demo

- Live Facebook / Instagram / YouTube publishing
- Shop photos, captions destined for the real account, or customer items
- Commercial image or copy generation

Those stay in the private owner workflow. See `NOTICE` for the license split.

## Next reading

- [Traditional Chinese version](GETTING_STARTED.zh-Hant.md)
- [How to contribute](CONTRIBUTING.md)
- [Public evidence page](docs/oss/index.html)
- [Maintainer changelog](CHANGELOG-OSS.md)
