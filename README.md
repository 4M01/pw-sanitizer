# playwright-sanitizer

Post-process Playwright HTML reports and trace files to **redact secrets** and **remove noisy steps** before sharing or archiving.

---

## Why

Playwright's HTML reports and `.zip` trace files can contain sensitive data — auth headers, API keys, tokens, passwords — embedded in network request logs, action parameters, and step metadata. `playwright-sanitizer` scans those files after your test run and replaces or strips the sensitive content so they are safe to store in CI artifacts, share with teammates, or upload to a dashboard.

It also lets you delete repetitive or internal steps (e.g. health-check pings, internal logging actions) that create noise in the trace viewer.

---

## Features

- Redact secrets in HTML reports and trace `.zip` files by key name, value pattern, or both
- Remove entire steps from traces with configurable timestamp repair
- Three output modes: `copy` (safe default), `in-place`, `side-by-side`
- Zero built-in patterns — you declare exactly what gets touched, nothing else runs
- Dry-run mode to preview changes without writing files
- Integrates as a Playwright `globalTeardown` so it runs automatically after every test run
- Programmatic API for custom pipelines
- Summary table printed to the console (and optionally written as JSON)

---

## Requirements

- Node.js >= 18

---

## Installation

```bash
npm install --save-dev playwright-sanitizer
```

Screenshot redaction inside trace files requires the optional `sharp` dependency:

```bash
npm install --save-dev sharp
```

---

## Quick start

### 1. Create a config file

```ts
// playwright-sanitizer.config.ts
import type { SanitizerConfig } from 'playwright-sanitizer';

const config: SanitizerConfig = {
  redact: {
    patterns: [
      {
        id: 'auth-header',
        description: 'Authorization header value',
        key: 'authorization',
        severity: 'critical',
      },
      {
        id: 'api-key',
        key: /x-api-key/i,
        severity: 'high',
      },
    ],
  },
  remove: {
    rules: [
      {
        label: 'health-check pings',
        url: /\/health$/,
      },
    ],
  },
};

export default config;
```

### 2. Run the CLI

```bash
npx playwright-sanitizer
```

Sanitized files are written to `./sanitized-report` by default. Originals are untouched.

---

## Configuration

Config is auto-discovered in this priority order:

| Priority | Source |
|----------|--------|
| 1 | `--config <path>` CLI flag |
| 2 | `playwright-sanitizer.config.ts` |
| 3 | `playwright-sanitizer.config.js` |
| 4 | `playwright-sanitizer.config.json` |
| 5 | `sanitizer` key inside `playwright.config.ts` |

### Full config reference

```ts
import type { SanitizerConfig } from 'playwright-sanitizer';

const config: SanitizerConfig = {
  redact: {
    // Inline patterns (merged with patternFiles)
    patterns: [
      {
        id: 'my-token',           // REQUIRED — unique identifier shown in summary
        description: 'API token', // optional, shown in summary output
        key: 'x-api-token',       // match field/header name (string = case-insensitive exact match)
        valuePattern: /^ey/,      // match field value (RegExp) — when set alongside key, BOTH must match
        severity: 'high',         // 'low' | 'medium' | 'high' | 'critical'  (informational only)
      },
    ],

    // External pattern files (.ts, .js, or .json) — merged with inline patterns
    patternFiles: ['./secrets/patterns.ts'],

    // Replacement string. Default: '[REDACTED]'
    placeholder: '[REDACTED]',

    // Partial redaction: keep first N and last N characters, mask the middle with '***'
    // Example: { prefix: 4, suffix: 4 } on 'Bearer eyJhbGci...' => 'Bear***..ci'
    // Takes priority over placeholder when set.
    partialRedaction: { prefix: 4, suffix: 4 },
  },

  remove: {
    // Inline rules (merged with ruleFiles)
    rules: [
      {
        label: 'noisy health checks',  // REQUIRED — shown in summary and dry-run log
        stepName: /health/i,           // match step name shown in the HTML report
        selector: '[data-testid="spinner"]', // match CSS selector or XPath locator
        url: /\/internal\//,           // match network request URL
        actionType: 'waitForTimeout',  // match Playwright internal action type

        // Safety guard: only remove if this step appears at least N times
        // consecutively within a test. Logs a warning and skips removal if not met.
        minConsecutiveOccurrences: 3,
      },
    ],

    // External rule files (.ts, .js, or .json) — merged with inline rules
    ruleFiles: ['./rules/remove-rules.ts'],

    // How to handle time after a step is deleted.
    // 'absorb-into-prev' (default): preceding step absorbs the deleted duration
    // 'absorb-into-next': following step's start time shifts back
    // 'gap': no adjustment; a gap appears in the timeline
    timestampStrategy: 'absorb-into-prev',

    // What to do with child steps when a parent is removed.
    // 'remove-children' (default): children are also removed
    // 'keep-shell': parent is kept as an empty container
    orphanStrategy: 'remove-children',

    // Preview mode — log what would be removed but don't write any files
    dryRun: false,
  },

  output: {
    reportDir: './playwright-report', // where to find HTML reports. Default: './playwright-report'
    traceDir: './test-results',       // where to find trace zips. Default: './test-results'

    // Output mode:
    // 'copy' (default): write sanitized files to dir, originals untouched
    // 'in-place': overwrite original files (ensure they are version-controlled!)
    // 'side-by-side': write '<name>.sanitized.<ext>' next to each original
    mode: 'copy',

    dir: './sanitized-report', // destination for 'copy' mode. Default: './sanitized-report'

    processReports: true,        // set to false to skip HTML report processing
    processTraces: true,         // set to false to skip trace file processing
    redactScreenshots: false,    // redact screenshots in traces (requires 'sharp')
  },

  reporting: {
    summary: true,                              // print summary table after processing. Default: true
    summaryFile: './sanitization-summary.json', // optional — write summary as JSON to this path
    logLevel: 'normal',                         // 'silent' | 'normal' | 'verbose'
  },
};

export default config;
```

---

## External pattern and rule files

For large teams, keep patterns and rules in dedicated files so they can be versioned and shared across projects:

```ts
// secrets/patterns.ts
import type { RedactPattern } from 'playwright-sanitizer';

const patterns: RedactPattern[] = [
  { id: 'auth-header', key: 'authorization', severity: 'critical' },
  { id: 'cookie',      key: 'cookie',        severity: 'high' },
  { id: 'set-cookie',  key: 'set-cookie',    severity: 'high' },
];

export default patterns;
```

```ts
// playwright-sanitizer.config.ts
export default {
  redact: { patternFiles: ['./secrets/patterns.ts'] },
};
```

JSON files are also supported. Note that RegExp is not available in JSON — strings are matched as case-insensitive exact key names:

```json
[
  { "id": "auth-header", "key": "authorization", "severity": "critical" },
  { "id": "api-key",     "key": "x-api-key",     "severity": "high" }
]
```

---

## CLI reference

```
Usage: playwright-sanitizer [options]

Options:
  -c, --config <path>          Path to config file
  -r, --report <path>          HTML report directory (default: "./playwright-report")
  -t, --traces <path>          Trace directory (default: "./test-results")
  -o, --output <path>          Output directory (copy mode)
      --in-place               Overwrite original files
      --patterns <path...>     One or more pattern files
      --placeholder <string>   Redaction placeholder (default: "[REDACTED]")
      --dry-run                Log changes without writing files
      --no-traces              Skip trace file processing
      --no-reports             Skip HTML report processing
      --summary-output <path>  Write JSON summary to file
      --log-level <level>      silent | normal | verbose (default: "normal")
  -V, --version                Display version number
  -h, --help                   Display help
```

### Examples

```bash
# Auto-discover config and run with defaults
npx playwright-sanitizer

# Use a specific config file
npx playwright-sanitizer --config ./ci/sanitizer.config.ts

# Overwrite originals (ensure files are version-controlled)
npx playwright-sanitizer --in-place

# Preview without writing any files
npx playwright-sanitizer --dry-run --log-level verbose

# Point to non-default directories
npx playwright-sanitizer --report ./reports --traces ./artifacts/traces --output ./sanitized

# Write a machine-readable summary for CI artifact ingestion
npx playwright-sanitizer --summary-output ./sanitization-summary.json
```

---

## Playwright globalTeardown integration

Register the sanitizer as a Playwright `globalTeardown` and it runs automatically after every test suite:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalTeardown: require.resolve('playwright-sanitizer/teardown'),
  // ...rest of your config
});
```

Config is auto-discovered as described above. Teardown failures are caught and logged — they will never mask your actual test results.

### Embedding config in playwright.config.ts

If you prefer a single config file, add a `sanitizer` key directly to your Playwright config:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { SanitizerConfig } from 'playwright-sanitizer';

export default defineConfig({
  globalTeardown: require.resolve('playwright-sanitizer/teardown'),

  sanitizer: {
    redact: {
      patterns: [
        { id: 'auth', key: 'authorization', severity: 'critical' },
      ],
    },
    output: { mode: 'in-place' },
  } satisfies SanitizerConfig,
});
```

---

## Programmatic API

```ts
import { sanitize, redactReport, redactTrace } from 'playwright-sanitizer';

// Process all reports and traces using auto-discovered config
const results = await sanitize();

// Pass a config object directly (skips file discovery)
const results = await sanitize({
  redact: { patterns: [{ id: 'token', key: 'x-token' }] },
  output: { mode: 'copy', dir: './out' },
});

// Process a single HTML report
const result = await redactReport('./playwright-report/index.html', config);

// Process a single trace zip
const result = await redactTrace('./test-results/my-test/trace.zip', config);
```

Each call returns a `ProcessResult` (or an array of them for `sanitize()`):

```ts
interface ProcessResult {
  file: string;
  redactionsApplied: number;
  stepsRemoved: number;
  timestampRepairs: number;
  redactionMatches: Array<{ keyPath: string; patternId: string }>;
  removalMatches: Array<{ index: number; ruleLabel: string; event: TraceEvent }>;
}
```

---

## Output modes

| Mode | Behaviour |
|------|-----------|
| `copy` (default) | Writes sanitized files to `output.dir` (`./sanitized-report`). Originals are never touched. |
| `in-place` | Overwrites original files. A warning is printed. Use only with version control. |
| `side-by-side` | Creates `<name>.sanitized.<ext>` next to each original file. |

---

## How redaction works

Redaction walks every JSON structure inside the HTML report's embedded data and the trace file's event entries. For each field encountered, the declared patterns are checked:

1. If `key` is a **string** — matched case-insensitively as an exact field name.
2. If `key` is a **RegExp** — tested against the field name.
3. If `valuePattern` is provided — both `key` and `valuePattern` must match (AND logic).
4. The matched value is replaced with `placeholder`, or a partial redaction if `partialRedaction` is configured.

No built-in patterns are ever applied. Only what you declare runs.

---

## How step removal works

Step removal operates on the trace event tree inside each `.zip` file:

1. Each event is tested against your declared rules (`stepName`, `selector`, `url`, `actionType`).
2. Matching events are collected and removed from the event list.
3. Timestamps of surrounding events are adjusted according to `timestampStrategy` to keep the timeline coherent.
4. Child steps of removed parents are handled according to `orphanStrategy`.

The `minConsecutiveOccurrences` safety guard prevents accidentally removing a step that only appears occasionally — if the actual consecutive count is below the threshold, the step is **not** removed and a warning is logged instead.

---

## CI integration example

```yaml
# .github/workflows/test.yml
- name: Run Playwright tests
  run: npx playwright test

- name: Sanitize Playwright artifacts
  run: npx playwright-sanitizer --summary-output sanitization-summary.json

- name: Upload sanitized report
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: sanitized-report/
```

---

## License

MIT
