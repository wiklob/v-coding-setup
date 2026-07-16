#!/usr/bin/env node
// custom-model-metadata — validate & resolve the routed custom-model registry.
//
// The registry (models/custom-models.json) records, per foreign model reached
// through an LLM gateway: the provider-advertised capability, the Claude Code
// client budget + compaction, route-specific EMPIRICAL context verification,
// and the fallback policy. Claude Code cannot infer a foreign model's context
// capacity behind a gateway, so extended (1M) mode is only ever recommended
// once a live probe has PROVEN the route accepts a request past the 200K
// gateway floor. This helper enforces that gate; it never launches Claude,
// edits settings, or touches the network.
//
// Usage:
//   custom-model-metadata validate [--registry <path>]
//   custom-model-metadata show <model-id> [--registry <path>] [--json]
//   custom-model-metadata resolve <model-id> [--context plain|extended] [--registry <path>] [--json]
//
// Exit: 0 success · 1 domain failure (invalid registry / gate not met) · 3 bad args.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DEFAULT_REGISTRY = path.join(REPO_ROOT, 'models', 'custom-models.json');

// The 200K gateway floor: Claude Code budgets a gateway-hidden model at 200K.
// Extended mode is only justified by proving the route accepts MORE than this.
const GATEWAY_FLOOR = 200000;
const SUFFIX = '[1m]';

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function die(code, msg) {
  process.stderr.write(`custom-model-metadata: ${msg}\n`);
  process.exit(code);
}

function hasSuffix(id) {
  return typeof id === 'string' && id.includes(SUFFIX);
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`${label} unreadable (${file}): ${e.code || e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${label} is not valid JSON (${file}): ${e.message}`);
  }
}

// --- structural + semantic validation ----------------------------------------
// Returns an array of human-readable problems ([] = clean). Structural checks
// mirror models/custom-models.schema.json; the semantic checks below are the
// ones JSON Schema cannot express.

function validateProvenance(p, where, errs, { needEvidence = false, needUrl = false } = {}) {
  if (!p || typeof p !== 'object') { errs.push(`${where}: missing provenance`); return; }
  const kinds = ['provider-documentation', 'harness-documentation', 'operator-observation', 'empirical-probe'];
  if (!kinds.includes(p.kind)) errs.push(`${where}: provenance.kind must be one of ${kinds.join(', ')}`);
  if (typeof p.authority !== 'string' || !p.authority.length) errs.push(`${where}: provenance.authority required`);
  if (!DATE_RE.test(p.retrievedAt || '')) errs.push(`${where}: provenance.retrievedAt must be YYYY-MM-DD`);
  if (needUrl && typeof p.url !== 'string') errs.push(`${where}: provenance.url required for documentation`);
  if (needEvidence && typeof p.evidence !== 'string') errs.push(`${where}: provenance.evidence path required`);
}

function validateCapacityClaim(c, where, errs) {
  if (!c || typeof c !== 'object') { errs.push(`${where}: missing`); return; }
  if (!Number.isInteger(c.tokens) || c.tokens < 1) errs.push(`${where}.tokens must be a positive integer`);
  validateProvenance(c.provenance, `${where}.provenance`, errs);
}

function evidenceObservedTokens(registryFile, evidencePath) {
  // Cross-check a "verified" route against its committed evidence artifact.
  // Evidence paths are repo-relative; the registry lives at <root>/models/,
  // so the repo root is two levels up from the registry file.
  // Returns { ok, tokens, wireModelId, error }.
  const repoRoot = path.dirname(path.dirname(registryFile));
  const abs = path.resolve(repoRoot, evidencePath);
  let doc;
  try {
    doc = readJson(abs, 'evidence');
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const live = doc && doc.live;
  if (!live || typeof live !== 'object') return { ok: false, error: `${evidencePath}: no live result block` };
  return {
    ok: true,
    tokens: Number.isInteger(live.observedInputTokens) ? live.observedInputTokens : null,
    wireModelId: typeof live.observedWireModelId === 'string' ? live.observedWireModelId : null,
    completed: live.completed === true,
  };
}

function validateRoute(route, model, registryFile, errs) {
  const where = `model ${model.id} route ${route.id || '?'}`;
  if (hasSuffix(route.upstreamModelId)) errs.push(`${where}: upstreamModelId must be suffix-free`);
  validateProvenance(route.authentication?.provenance, `${where}.authentication`, errs, { needEvidence: route.authentication?.kind === 'codex-oauth-subscription' });

  const cv = route.contextVerification || {};
  const statuses = ['pending-live-probe', 'verified', 'rejected'];
  if (!statuses.includes(cv.status)) errs.push(`${where}: contextVerification.status invalid`);

  if (cv.status === 'verified') {
    // A provider-documentation claim can NEVER satisfy a route's live gate.
    if (!Number.isInteger(cv.verifiedInputTokensAtLeast) || cv.verifiedInputTokensAtLeast <= GATEWAY_FLOOR) {
      errs.push(`${where}: verified requires verifiedInputTokensAtLeast > ${GATEWAY_FLOOR} (the gateway floor)`);
    }
    if (hasSuffix(cv.observedWireModelId) || cv.observedWireModelId !== route.upstreamModelId) {
      errs.push(`${where}: verified requires observedWireModelId === upstreamModelId ("${route.upstreamModelId}") and suffix-free`);
    }
    if (!DATE_RE.test(cv.verifiedAt || '')) errs.push(`${where}: verified requires verifiedAt date`);
    if (typeof cv.evidence !== 'string') errs.push(`${where}: verified requires an evidence path`);
    else {
      const ev = evidenceObservedTokens(registryFile, cv.evidence);
      if (!ev.ok) errs.push(`${where}: evidence check failed — ${ev.error}`);
      else {
        if (!ev.completed) errs.push(`${where}: evidence live.completed is not true`);
        if (ev.tokens !== cv.verifiedInputTokensAtLeast) {
          errs.push(`${where}: verifiedInputTokensAtLeast (${cv.verifiedInputTokensAtLeast}) must equal evidence observedInputTokens (${ev.tokens})`);
        }
        if (ev.wireModelId !== cv.observedWireModelId) {
          errs.push(`${where}: observedWireModelId (${cv.observedWireModelId}) must equal evidence observedWireModelId (${ev.wireModelId})`);
        }
      }
    }
  }
}

function isRouteVerified(route) {
  const cv = route.contextVerification || {};
  return cv.status === 'verified'
    && Number.isInteger(cv.verifiedInputTokensAtLeast)
    && cv.verifiedInputTokensAtLeast > GATEWAY_FLOOR
    && !hasSuffix(cv.observedWireModelId)
    && cv.observedWireModelId === route.upstreamModelId;
}

function validateModel(model, registryFile, errs) {
  const where = `model ${model.id || '?'}`;
  if (typeof model.id !== 'string' || !model.id.length) errs.push(`${where}: id required`);
  if (hasSuffix(model.id)) errs.push(`${where}: id must be suffix-free`);

  validateCapacityClaim(model.capabilities?.inputContextTokens, `${where}.capabilities.inputContextTokens`, errs);
  validateCapacityClaim(model.capabilities?.maxOutputTokens, `${where}.capabilities.maxOutputTokens`, errs);

  const cc = model.claudeCode || {};
  if (cc.extendedContextSuffix !== SUFFIX) errs.push(`${where}: claudeCode.extendedContextSuffix must be "${SUFFIX}"`);
  if (!Number.isInteger(cc.budgetedInputTokens) || cc.budgetedInputTokens < 1) errs.push(`${where}: claudeCode.budgetedInputTokens must be a positive integer`);
  if (!['plain', 'extended'].includes(cc.preferredContextMode)) errs.push(`${where}: claudeCode.preferredContextMode invalid`);

  const comp = cc.compaction || {};
  if (!['pending-observation', 'documented', 'observed'].includes(comp.status)) errs.push(`${where}: compaction.status invalid`);
  if (comp.expectedUsableInputTokens != null) {
    if (!Number.isInteger(comp.expectedUsableInputTokens) || comp.expectedUsableInputTokens < 1) {
      errs.push(`${where}: compaction.expectedUsableInputTokens must be a positive integer or null`);
    } else if (Number.isInteger(cc.budgetedInputTokens) && comp.expectedUsableInputTokens > cc.budgetedInputTokens) {
      errs.push(`${where}: compaction.expectedUsableInputTokens (${comp.expectedUsableInputTokens}) exceeds budgetedInputTokens (${cc.budgetedInputTokens})`);
    }
  }
  if (comp.status === 'observed' || comp.status === 'documented') {
    if (comp.expectedUsableInputTokens == null) errs.push(`${where}: compaction ${comp.status} requires expectedUsableInputTokens`);
    validateProvenance(comp.provenance, `${where}.compaction.provenance`, errs);
  }

  const routes = Array.isArray(model.routes) ? model.routes : [];
  if (!routes.length) errs.push(`${where}: at least one route required`);
  for (const r of routes) validateRoute(r, model, registryFile, errs);

  const fb = model.fallback || {};
  if (!['plain', 'extended'].includes(fb.contextMode)) errs.push(`${where}: fallback.contextMode invalid`);
  if (typeof fb.modelId !== 'string' || hasSuffix(fb.modelId)) errs.push(`${where}: fallback.modelId must be a suffix-free string`);
  if (fb.scope !== 'session') errs.push(`${where}: fallback.scope must be "session"`);

  // The core gate: extended may be preferred ONLY when a route is verified past
  // the gateway floor. Provider docs about the model's 1.05M window do not count.
  if (cc.preferredContextMode === 'extended' && !routes.some(isRouteVerified)) {
    errs.push(`${where}: preferredContextMode "extended" requires a route with contextVerification.status "verified" (>${GATEWAY_FLOOR} observed input tokens). No route qualifies.`);
  }
}

function loadRegistry(file) {
  const reg = readJson(file, 'registry');
  if (reg.schemaVersion !== 1) throw new Error(`unsupported schemaVersion ${JSON.stringify(reg.schemaVersion)} (this tool understands 1)`);
  if (!Array.isArray(reg.models)) throw new Error('registry.models must be an array');
  return reg;
}

function validate(file) {
  const reg = loadRegistry(file);
  const errs = [];
  const seen = new Set();
  for (const m of reg.models) {
    if (seen.has(m.id)) errs.push(`duplicate model id ${m.id}`);
    seen.add(m.id);
    validateModel(m, file, errs);
  }
  return errs;
}

function findModel(reg, id) {
  const base = id.replace(SUFFIX, '');
  return reg.models.find((m) => m.id === base);
}

// --- resolution ---------------------------------------------------------------
// Pure: maps a requested id (+ optional --context) to the wire id and fallback.
// Emits what a launcher WOULD send; it never launches anything.

function resolve(reg, requestedId, contextFlag) {
  const model = findModel(reg, requestedId);
  if (!model) throw new Error(`no registry entry for "${requestedId}"`);
  const verified = (model.routes || []).some(isRouteVerified);
  const requestedExtended = contextFlag ? contextFlag === 'extended' : hasSuffix(requestedId) || model.claudeCode.preferredContextMode === 'extended';
  const mode = requestedExtended ? 'extended' : 'plain';
  return {
    requestedModelId: mode === 'extended' ? `${model.id}${SUFFIX}` : model.id,
    expectedWireModelId: model.id, // Claude Code strips [1m] before the request leaves
    contextMode: mode,
    routeVerified: verified,
    extendedRecommended: model.claudeCode.preferredContextMode === 'extended',
    budgetedInputTokens: model.claudeCode.budgetedInputTokens,
    expectedUsableInputTokens: model.claudeCode.compaction.expectedUsableInputTokens,
    fallbackModelId: model.fallback.modelId,
  };
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--registry') opts.registry = argv[++i];
    else if (a === '--context') opts.context = argv[++i];
    else if (a.startsWith('--')) die(3, `unknown flag ${a}`);
    else positional.push(a);
  }
  return { positional, opts };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, opts } = parseArgs(rest);
  const registryFile = opts.registry ? path.resolve(opts.registry) : DEFAULT_REGISTRY;

  if (opts.context && !['plain', 'extended'].includes(opts.context)) die(3, `--context must be plain or extended`);

  try {
    if (cmd === 'validate') {
      const errs = validate(registryFile);
      if (errs.length) {
        for (const e of errs) process.stderr.write(`  ✗ ${e}\n`);
        die(1, `registry invalid (${errs.length} problem${errs.length === 1 ? '' : 's'})`);
      }
      process.stdout.write(`registry OK (${loadRegistry(registryFile).models.length} model(s))\n`);
      return;
    }

    if (cmd === 'show') {
      const id = positional[0];
      if (!id) die(3, 'show needs a model id');
      const reg = loadRegistry(registryFile);
      const model = findModel(reg, id);
      if (!model) die(1, `no registry entry for "${id}"`);
      process.stdout.write(JSON.stringify(model, null, opts.json ? 0 : 2) + '\n');
      return;
    }

    if (cmd === 'resolve') {
      const id = positional[0];
      if (!id) die(3, 'resolve needs a model id');
      const reg = loadRegistry(registryFile);
      const out = resolve(reg, id, opts.context);
      if (opts.json) process.stdout.write(JSON.stringify(out) + '\n');
      else {
        process.stdout.write(
          `requested : ${out.requestedModelId}\n` +
          `wire id   : ${out.expectedWireModelId}   (Claude Code strips ${SUFFIX})\n` +
          `mode      : ${out.contextMode}${out.contextMode === 'extended' && !out.routeVerified ? '  ⚠ route not yet verified past the 200K floor' : ''}\n` +
          `budget    : ${out.budgetedInputTokens} input tokens\n` +
          `fallback  : ${out.fallbackModelId}  (one-command / one-session, plain window)\n`);
      }
      return;
    }

    die(3, `unknown command ${JSON.stringify(cmd)} — expected validate | show | resolve`);
  } catch (e) {
    die(1, e.message);
  }
}

export { validate, resolve, loadRegistry, findModel, isRouteVerified, GATEWAY_FLOOR };

// Run the CLI only when invoked directly, so tests can import the functions.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
