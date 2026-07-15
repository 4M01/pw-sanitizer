import fs from 'node:fs';
import JSZip from 'jszip';

async function main() {
  const fixturePath = 'd:/side-project/node-modules/pw-sanitizer/tests/fixtures/playwright-project/test-results/real-actions-real-actions-without-test-step/trace.zip';
  const zip = await JSZip.loadAsync(fs.readFileSync(fixturePath));
  
  console.log('Files in zip:');
  zip.forEach((rel) => console.log(' -', rel));

  const traceEntry = zip.file(Object.keys(zip.files).find(name => name.endsWith('.trace')));
  if (traceEntry) {
    const content = await traceEntry.async('string');
    const lines = content.split('\n').filter(Boolean).map(l => JSON.parse(l));
    console.log('\n--- Sample trace events ---');
    console.log('Total events:', lines.length);
    console.log('Unique types:', [...new Set(lines.map(l => l.type))]);
    
    // Find some sample actions/steps
    const actions = lines.filter(l => l.type === 'before');
    console.log('\nTotal actions/steps in trace:', actions.length);
    
    console.log('\nSample action/step titles/methods:');
    actions.forEach(a => {
      console.log(` - title: "${a.title}", apiName: "${a.apiName}", method: "${a.method}", class: "${a.class}", callId: "${a.callId}", parentId: "${a.parentId}"`);
    });
  }

  // Find a network file
  const networkName = Object.keys(zip.files).find(name => name.endsWith('.network'));
  if (networkName) {
    const networkEntry = zip.file(networkName);
    const content = await networkEntry.async('string');
    const lines = content.split('\n').filter(Boolean).map(l => JSON.parse(l));
    console.log(`\n--- Sample ${networkName} events ---`);
    console.log('Total network events:', lines.length);
    console.log('Sample network event:', lines[0]);
    console.log('Network event keys:', Object.keys(lines[0] || {}));
    
    console.log('\nAll network events:');
    lines.forEach(n => {
      console.log(` - type: "${n.type}", url: "${n.url || n.request?.url}", callId: "${n.callId}"`);
    });
  }
}

main().catch(console.error);
