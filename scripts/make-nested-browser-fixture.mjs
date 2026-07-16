// Generates a real-format Playwright trace.zip fixture with:
//  - a test.trace runner stream containing a step nested >=3 levels deep
//    (test.step@10 > test.step@11 > pw:api@12) whose leaves have browser children
//  - a 0-trace.trace browser stream whose events correlate back to test.trace
//    ONLY via the `stepId` field (before/after actions), plus auxiliary
//    `event`/`log` entries and `frame-snapshot` entries (callId nested under
//    snapshot.callId) that reference the same calls.
// Event shapes mirror a genuine Playwright 1.61 trace (verified against the
// real-actions fixture in this repo).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../tests/fixtures/real/nested-browser');
fs.mkdirSync(outDir, { recursive: true });

const j = (o) => JSON.stringify(o);
let t = 1000; // monotonic clock
const tick = (d = 5) => (t += d);

// ---- test.trace (runner stream) ----
const test = [];
test.push(j({
  version: 8, type: 'context-options', origin: 'testRunner', browserName: 'chromium',
  playwrightVersion: '1.61.1', options: {}, platform: 'linux', wallTime: 1784137391165,
  monotonicTime: tick(), sdkLanguage: 'javascript',
  title: 'nested-browser.spec.ts:3 › nested step with browser children',
}));

function step(callId, title, parentId, method = 'test.step', cls = 'Test') {
  const start = tick();
  const before = { type: 'before', callId, stepId: callId, startTime: start, class: cls, method, title, params: {} };
  if (parentId) before.parentId = parentId;
  return {
    before: j(before),
    after: (endBump = 5) => j({ type: 'after', callId, endTime: tick(endBump) }),
  };
}

// Level 1 shell
const s10 = step('test.step@10', 'outer login flow', undefined);
test.push(s10.before);
//   Level 2
const s11 = step('test.step@11', 'wait for spinner', 'test.step@10');
test.push(s11.before);
//     Level 3 leaves (browser-backed)
const a12 = step('pw:api@12', 'Wait for selector', 'test.step@11', 'pw:api');
test.push(a12.before); test.push(a12.after());
const a13 = step('pw:api@13', 'Is visible', 'test.step@11', 'pw:api');
test.push(a13.before); test.push(a13.after());
test.push(s11.after());
//   Level 2 leaf (browser-backed)
const a14 = step('pw:api@14', 'Wait for event info', 'test.step@10', 'pw:api');
test.push(a14.before); test.push(a14.after());
test.push(s10.after());

// Unrelated kept subtree with its own browser child
const s20 = step('test.step@20', 'assert dashboard', undefined);
test.push(s20.before);
const e21 = step('pw:api@21', 'Wait for selector', 'test.step@20', 'pw:api');
test.push(e21.before); test.push(e21.after());
test.push(s20.after());

// ---- 0-trace.trace (browser stream) ----
const brow = [];
brow.push(j({
  version: 8, type: 'context-options', origin: 'library', browserName: 'chromium',
  playwrightVersion: '1.61.1', options: {}, platform: 'linux', wallTime: 1784137391165,
  monotonicTime: tick(), sdkLanguage: 'javascript',
  contextId: 'browser-context@abc', title: 'nested-browser',
}));

// A browser action = before + (snapshots/log/event) + after, correlated by stepId.
function browserAction({ callId, stepId, method, cls = 'Frame', selector, withSnapshots = false, withLog = false }) {
  const start = tick();
  const before = { type: 'before', callId, startTime: start, class: cls, method, params: selector ? { selector } : {}, stepId, pageId: 'page@1' };
  if (withSnapshots) before.beforeSnapshot = `before@${callId}`;
  brow.push(j(before));
  if (withSnapshots) brow.push(j({ type: 'frame-snapshot', snapshot: { callId, snapshotName: `before@${callId}`, pageId: 'page@1', frameId: 'frame@1', frameUrl: 'about:blank', html: ['HTML', {}], viewport: { width: 1280, height: 720 }, timestamp: tick(1) } }));
  if (withLog) brow.push(j({ type: 'log', callId, time: tick(1), message: `running ${method}` }));
  const after = { type: 'after', callId, endTime: tick() };
  if (withSnapshots) after.afterSnapshot = `after@${callId}`;
  brow.push(j(after));
  if (withSnapshots) brow.push(j({ type: 'frame-snapshot', snapshot: { callId, snapshotName: `after@${callId}`, pageId: 'page@1', frameId: 'frame@1', frameUrl: 'about:blank', html: ['HTML', {}], viewport: { width: 1280, height: 720 }, timestamp: tick(1) } }));
}

// waitForSelector (pw:api@12) — 10 orphan-prone calls with snapshots + log
for (let i = 0; i < 10; i++) {
  browserAction({ callId: `call@${100 + i}`, stepId: 'pw:api@12', method: 'waitForSelector', selector: '#spinner', withSnapshots: true, withLog: true });
}
// A pure-stepId `event` entry under pw:api@12 whose callId never had a `before`.
brow.push(j({ type: 'event', callId: 'call@199', stepId: 'pw:api@12', time: tick(1), class: 'Frame', method: 'navigated', params: {} }));

// isVisible (pw:api@13) — 5 calls
for (let i = 0; i < 5; i++) {
  browserAction({ callId: `call@${120 + i}`, stepId: 'pw:api@13', method: 'isVisible', selector: '#spinner', cls: 'Frame' });
}
// waitForEventInfo (pw:api@14) — 60 calls (bulk of orphans in the real report)
for (let i = 0; i < 60; i++) {
  browserAction({ callId: `call@${200 + i}`, stepId: 'pw:api@14', method: 'waitForEventInfo', cls: 'Frame' });
}

// Kept browser child under the surviving subtree (must NOT be removed).
browserAction({ callId: 'call@900', stepId: 'pw:api@21', method: 'waitForSelector', selector: '#dashboard', withSnapshots: true });

const zip = new JSZip();
zip.file('test.trace', test.join('\n') + '\n');
zip.file('0-trace.trace', brow.join('\n') + '\n');
// minimal network + resources presence (empty but real filenames)
zip.file('0-trace.network', '');

const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(path.join(outDir, 'trace.zip'), buf);
console.log('Wrote', path.join(outDir, 'trace.zip'), buf.length, 'bytes');
console.log('test.trace lines:', test.length, '| 0-trace.trace lines:', brow.length);
