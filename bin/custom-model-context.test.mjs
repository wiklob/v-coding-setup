#!/usr/bin/env node
// Hermetic tests for the routed custom-model context layer (V-383):
//   - bin/custom-model-metadata.mjs  (registry validation + resolution gate)
//   - bin/probe-custom-model-context.mjs  (capture-mode suffix-strip proof)
//
// No network, no real Claude, no subscription use. The capture probe is driven
// against a fake `claude` stub so the end-to-end wire-id assertion is exercised
// deterministically. The `live` probe is a manual, network-bound proof and is
// intentionally NOT run here.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, resolve, loadRegistry } from './custom-model-metadata.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; process.stderr.write(`  ✗ ${label}\n`); }
}

// --- fixtures -----------------------------------------------------------------

function baseModel(overrides = {}) {
  const prov = (kind, extra = {}) => ({ kind, authority: 'test', retrievedAt: '2026-07-16', ...extra });
  return {
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    provider: 'openai',
    capabilities: {
      inputContextTokens: { tokens: 1050000, provenance: prov('provider-documentation', { url: 'https://example/openai' }) },
      maxOutputTokens: { tokens: 128000, provenance: prov('provider-documentation', { url: 'https://example/openai' }) },
    },
    claudeCode: {
      extendedContextSuffix: '[1m]',
      budgetedInputTokens: 1000000,
      preferredContextMode: 'plain',
      compaction: { status: 'pending-observation', expectedUsableInputTokens: null, autoCompactWindowEnv: 'X', provenance: null },
    },
    routes: [{
      id: 'codex-oauth-cliproxy',
      gateway: 'CLIProxyAPI',
      authentication: { kind: 'codex-oauth-subscription', provenance: prov('operator-observation', { evidence: 'models/evidence/x.json' }) },
      upstreamModelId: 'gpt-5.6-sol',
      contextVerification: { status: 'pending-live-probe', verifiedInputTokensAtLeast: null, observedWireModelId: null, verifiedAt: null, probe: 'bin/probe-custom-model-context.mjs', evidence: 'models/evidence/x.json' },
    }],
    fallback: { contextMode: 'plain', modelId: 'gpt-5.6-sol', scope: 'session' },
    ...overrides,
  };
}

// Write a registry (+ optional evidence) into a temp <root>/models/ layout and
// return the registry file path so evidence resolves like the real repo.
function writeRegistry(model, evidence) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v383-'));
  fs.mkdirSync(path.join(root, 'models', 'evidence'), { recursive: true });
  const regFile = path.join(root, 'models', 'custom-models.json');
  fs.writeFileSync(regFile, JSON.stringify({ schemaVersion: 1, models: [model] }, null, 2));
  if (evidence) fs.writeFileSync(path.join(root, 'models', 'evidence', 'x.json'), JSON.stringify(evidence, null, 2));
  return regFile;
}

// --- registry validation ------------------------------------------------------

// 1. The shipped registry validates.
{
  const errs = validate(path.join(HERE, '..', 'models', 'custom-models.json'));
  ok(errs.length === 0, `shipped registry validates cleanly (got: ${errs.join('; ')})`);
}

// 2. A well-formed pending registry validates.
ok(validate(writeRegistry(baseModel())).length === 0, 'pending registry validates');

// 3. Missing provenance on a capacity claim is rejected.
{
  const m = baseModel();
  delete m.capabilities.inputContextTokens.provenance;
  ok(validate(writeRegistry(m)).some((e) => /provenance/.test(e)), 'missing capacity provenance rejected');
}

// 4. preferredContextMode "extended" with no verified route is rejected.
{
  const m = baseModel();
  m.claudeCode.preferredContextMode = 'extended';
  ok(validate(writeRegistry(m)).some((e) => /extended.*requires a route/.test(e)), 'extended without verified route rejected');
}

// 5. A verified route backed by matching evidence enables extended.
{
  const m = baseModel();
  m.claudeCode.preferredContextMode = 'extended';
  m.routes[0].contextVerification = {
    status: 'verified', verifiedInputTokensAtLeast: 241837, observedWireModelId: 'gpt-5.6-sol',
    verifiedAt: '2026-07-16', probe: 'bin/probe-custom-model-context.mjs', evidence: 'models/evidence/x.json',
  };
  const evidence = { live: { observedInputTokens: 241837, observedWireModelId: 'gpt-5.6-sol', completed: true } };
  ok(validate(writeRegistry(m, evidence)).length === 0, 'verified route + matching evidence enables extended');
}

// 6. Verified but observed usage NOT above the 200K floor is rejected.
{
  const m = baseModel();
  m.routes[0].contextVerification = {
    status: 'verified', verifiedInputTokensAtLeast: 200000, observedWireModelId: 'gpt-5.6-sol',
    verifiedAt: '2026-07-16', probe: 'p', evidence: 'models/evidence/x.json',
  };
  const evidence = { live: { observedInputTokens: 200000, observedWireModelId: 'gpt-5.6-sol', completed: true } };
  ok(validate(writeRegistry(m, evidence)).some((e) => /gateway floor/.test(e)), 'verified at exactly 200K (not above) rejected');
}

// 7. verifiedInputTokensAtLeast that disagrees with the evidence is rejected.
{
  const m = baseModel();
  m.routes[0].contextVerification = {
    status: 'verified', verifiedInputTokensAtLeast: 300000, observedWireModelId: 'gpt-5.6-sol',
    verifiedAt: '2026-07-16', probe: 'p', evidence: 'models/evidence/x.json',
  };
  const evidence = { live: { observedInputTokens: 241837, observedWireModelId: 'gpt-5.6-sol', completed: true } };
  ok(validate(writeRegistry(m, evidence)).some((e) => /must equal evidence/.test(e)), 'evidence mismatch rejected');
}

// 8. A [1m] suffix leaking into the observed wire id is rejected.
{
  const m = baseModel();
  m.routes[0].contextVerification = {
    status: 'verified', verifiedInputTokensAtLeast: 241837, observedWireModelId: 'gpt-5.6-sol[1m]',
    verifiedAt: '2026-07-16', probe: 'p', evidence: 'models/evidence/x.json',
  };
  const evidence = { live: { observedInputTokens: 241837, observedWireModelId: 'gpt-5.6-sol[1m]', completed: true } };
  ok(validate(writeRegistry(m, evidence)).some((e) => /observedWireModelId/.test(e)), 'suffix in wire id rejected');
}

// 9. compaction threshold above the client budget is rejected.
{
  const m = baseModel();
  m.claudeCode.compaction = { status: 'observed', expectedUsableInputTokens: 1200000, autoCompactWindowEnv: 'X', provenance: { kind: 'operator-observation', authority: 't', retrievedAt: '2026-07-16', evidence: 'models/evidence/x.json' } };
  ok(validate(writeRegistry(m)).some((e) => /exceeds budgetedInputTokens/.test(e)), 'compaction over budget rejected');
}

// 10. unsupported schemaVersion throws.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v383-'));
  const f = path.join(root, 'r.json');
  fs.writeFileSync(f, JSON.stringify({ schemaVersion: 99, models: [] }));
  let threw = false;
  try { loadRegistry(f); } catch { threw = true; }
  ok(threw, 'unsupported schemaVersion throws');
}

// --- resolution ---------------------------------------------------------------

{
  const reg = loadRegistry(writeRegistry(baseModel()));
  const plain = resolve(reg, 'gpt-5.6-sol');
  ok(plain.contextMode === 'plain' && plain.expectedWireModelId === 'gpt-5.6-sol', 'plain resolve → base wire id');
  const ext = resolve(reg, 'gpt-5.6-sol[1m]');
  ok(ext.contextMode === 'extended' && ext.expectedWireModelId === 'gpt-5.6-sol' && ext.routeVerified === false, 'extended resolve strips suffix, flags unverified');
  ok(resolve(reg, 'gpt-5.6-sol', undefined).fallbackModelId === 'gpt-5.6-sol', 'fallback id is the plain base');
}

// --- capture probe (fake claude) ---------------------------------------------
// A stub that mimics Claude Code: reads ANTHROPIC_BASE_URL and POSTs a
// /v1/messages carrying the model id. `strip` controls whether it removes [1m]
// (real behavior) — so we can assert both the PASS and the FAIL detection.

function fakeClaude(strip) {
  return `#!/usr/bin/env node
const http = require('node:http');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('2.1.202 (Claude Code)\\n'); process.exit(0); }
let model = args[args.indexOf('--model') + 1] || '';
if (${strip ? 'true' : 'false'}) model = model.replace('[1m]', '');
// The probe supplies the base URL via --settings JSON (mirroring how real
// Claude Code takes ANTHROPIC_BASE_URL from a settings env block).
const settings = JSON.parse(args[args.indexOf('--settings') + 1] || '{}');
const base = (settings.env && settings.env.ANTHROPIC_BASE_URL) || process.env.ANTHROPIC_BASE_URL;
const u = new URL(base + '/v1/messages');
const body = JSON.stringify({ model, messages: [], stream: false });
const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { res.resume(); res.on('end', () => { process.stdout.write('ok\\n'); process.exit(0); }); });
req.on('error', () => process.exit(1));
req.end(body);
`;
}

function runCapture(strip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v383-claude-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, fakeClaude(strip), { mode: 0o755 });
  const r = spawnSync('node', [path.join(HERE, 'probe-custom-model-context.mjs'), 'capture', '--model', 'gpt-5.6-sol', '--claude-bin', bin, '--json', '--timeout-ms', '20000'], { encoding: 'utf8' });
  let out = null;
  try { out = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { /* leave null */ }
  return { code: r.status, out };
}

// 11. Stripping stub → probe PASSES and observes the base wire id.
{
  const { code, out } = runCapture(true);
  ok(code === 0 && out && out.pass === true && out.observedWireModelId === 'gpt-5.6-sol' && out.suffixStrippedUpstream === true, 'capture: stripping client → pass, base wire id');
}

// 12. Non-stripping stub → probe FAILS and flags the leaked suffix.
{
  const { code, out } = runCapture(false);
  ok(code === 1 && out && out.pass === false && out.suffixStrippedUpstream === false && /\[1m\]/.test(out.observedWireModelId || ''), 'capture: leaked suffix → fail');
}

// --- summary ------------------------------------------------------------------
process.stdout.write(`custom-model-context.test: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
