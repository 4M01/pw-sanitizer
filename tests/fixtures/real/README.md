# Real Playwright fixtures

These artifacts are **genuine, unmodified outputs of real Playwright runs** —
do not hand-craft or edit them. Hand-crafted fixtures in an invented format are
exactly how the 0.1.x format bug shipped.

| Folder      | Generated with        | Notes                                                                 |
| ----------- | --------------------- | --------------------------------------------------------------------- |
| `modern/`   | @playwright/test 1.61 | `test.step`-based spec; `<template id="playwrightReportBase64">`      |
| `v1.40/`    | @playwright/test 1.40 | same spec; `window.playwrightReportBase64 = "data:...";` script form  |
| `no-steps/` | @playwright/test 1.61 | **no `test.step` at all** — APIRequestContext calls against a local HTTP server. The zip contains `test.trace` (pw:api runner steps), `0-trace.trace` (library `call@N` events linked via `stepId`, plus `log` lines), `0-trace.network` (`resource-snapshot` entries without callIds) and `0-trace.stacks`. |
| `nested-browser/` | **real-format synthetic** (see caveat below) | A step nested **three levels deep** (`test.step` → `test.step` → `pw:api`) whose leaves have browser children in `0-trace.trace`, correlated back only via `stepId`, plus `frame-snapshot` lines (`snapshot.callId`) and a fire-and-forget `event`. Exercises the cross-stream orphan removal in `tests/integration/cross-stream-orphans.test.ts`. |

> **Caveat — `nested-browser/` is the one synthetic fixture here.** No genuine
> capture in this repo happens to combine a ≥3-level-deep step with browser-side
> children, so this archive is assembled by
> `scripts/make-nested-browser-fixture.mjs` using the **exact** event shapes a
> real Playwright 1.61 trace emits (verified byte-for-byte against the
> `no-steps/` and `playwright-project/.../real-actions` captures). The
> authoritative test builds the same structure in-memory; the committed `.zip`
> is a convenience for manual inspection with `npx playwright show-trace`. If
> you can capture a genuine run with this shape, replace it and drop the
> generator.

`modern/trace-viewer-asset.html` is the genuine static
`playwright-report/trace/index.html` shipped inside the report directory
(used by the warning-suppression tests).

Each folder contains:

- `trace.zip` — a real trace archive (`test.trace` NDJSON event stream +
  `resources/`), produced with `use: { trace: 'on' }`.
- `index.html` — a real HTML report with the base64-zip payload embedded.

## Regenerating

The generator project lives in `tests/fixtures/playwright-project`. To
regenerate (e.g. against a newer Playwright):

```bash
cd tests/fixtures/playwright-project
npm i -D @playwright/test        # pick the version you want to verify
npx playwright test              # no browser needed — the spec only uses test.step
cp test-results/example-login-flow-with-noisy-waits/trace.zip ../real/<target>/trace.zip
cp playwright-report/index.html ../real/<target>/index.html

# no-steps fixtures (APIRequestContext, no browser needed either):
npx playwright test -c playwright-no-steps.config.ts
cp test-results2/no-steps-api-flow-without-test-step/trace.zip ../real/no-steps/trace.zip
cp playwright-report2/index.html ../real/no-steps/index.html
```

The main spec (`tests/example.spec.ts`) deliberately produces nested
`waitForSpinnerToDisappear: ...` steps with children, matching the removal
rules exercised by `tests/integration/real-artifacts.test.ts`. The no-steps
spec (`tests-no-steps/no-steps.spec.ts`) uses NO `test.step` and drives a
local HTTP server through `request.get()`, producing linked library-trace
events and network snapshots for `tests/integration/real-artifacts-no-steps.test.ts`.
