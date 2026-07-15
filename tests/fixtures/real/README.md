# Real Playwright fixtures

These artifacts are **genuine, unmodified outputs of real Playwright runs** —
do not hand-craft or edit them. Hand-crafted fixtures in an invented format are
exactly how the 0.1.x format bug shipped.

| Folder    | Generated with       | HTML embedding style                                  |
| --------- | -------------------- | ----------------------------------------------------- |
| `modern/` | @playwright/test 1.61 | `<template id="playwrightReportBase64">` element      |
| `v1.40/`  | @playwright/test 1.40 | `window.playwrightReportBase64 = "data:...";` script  |

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
```

The spec (`tests/example.spec.ts`) deliberately produces nested
`waitForSpinnerToDisappear: ...` steps with children, matching the removal
rules exercised by `tests/integration/real-artifacts.test.ts`.
