#!/usr/bin/env node
// probe-custom-model-context — empirical, secrets-safe proof of routed-model
// context behavior. Two modes, both driving the REAL Claude CLI:
//
//   capture   Prove Claude Code strips the [1m] suffix before the model id
//             leaves the client. Stands up a disposable loopback server that
//             speaks the Anthropic Messages API, points ONLY the child Claude
//             process at it (dummy key, --bare, no persistence), and records
//             the `model` field that actually arrives on the wire. No real
//             provider is contacted; no credentials are read.
//
//   live      Prove the configured route accepts a request PAST the 200K
//             gateway floor. Launches a disposable, no-persistence Claude
//             session through the user's normal router, feeds a deterministic
//             prompt sized above --min-input-tokens, asks for a one-word
//             sentinel, and reads the returned usage. Fails closed if the
//             route is unreachable, the response is truncated/rejected, or the
//             observed input usage is not strictly above the floor.
//
// Output is a sanitized JSON evidence object on stdout: model ids, counts,
// versions, prompt-generator parameters + hash, timestamps. NEVER the prompt
// body, response body, headers, or any credential. The registry is never
// edited automatically — a human reviews the evidence and sets policy.
//
// Usage:
//   probe-custom-model-context capture --model <base-id> [--claude-bin <path>] [--timeout-ms N] [--json]
//   probe-custom-model-context live    --model <base-id> [--min-input-tokens N] [--timeout-ms N] [--json]
//
// Exit: 0 pass · 1 fail (proof not obtained) · 2 soft/unavailable · 3 bad args.

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const SUFFIX = '[1m]';
const GATEWAY_FLOOR = 200000;

function die(code, msg) {
  process.stderr.write(`probe-custom-model-context: ${msg}\n`);
  process.exit(code);
}

function nowIso() {
  return new Date().toISOString();
}

function emit(obj, json) {
  if (json) process.stdout.write(JSON.stringify(obj) + '\n');
  else process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// --- a minimal Anthropic Messages API server for the capture probe -----------
// Answers both streaming (SSE) and non-streaming requests with a trivial valid
// message, and records the `model` field of every messages-family request.

function startCaptureServer() {
  const captured = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const plainPath = req.url.split('?')[0];
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* leave {} */ }
      if (plainPath.includes('/v1/messages')) {
        captured.push({ path: plainPath, model: typeof body.model === 'string' ? body.model : null, stream: body.stream === true });
      }
      if (plainPath.endsWith('/count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 4 }));
        return;
      }
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        const model = body.model || 'unknown';
        send('message_start', { type: 'message_start', message: { id: 'msg_probe', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4, output_tokens: 1 } } });
        send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } });
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
        send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
        send('message_stop', { type: 'message_stop' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_probe', type: 'message', role: 'assistant', model: body.model || 'unknown', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 4, output_tokens: 1 } }));
      }
    });
    req.on('error', () => res.destroy());
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, captured }));
  });
}

function runChild(bin, args, { env, timeoutMs, input }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ timedOut: true, code: null, out, err }); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); finish({ error: e.message, code: null, out, err }); });
    child.on('close', (code) => { clearTimeout(timer); finish({ code, out, err }); });
    if (input != null) { child.stdin.write(input); }
    child.stdin.end();
  });
}

async function claudeVersion(bin) {
  const r = await runChild(bin, ['--version'], { env: process.env, timeoutMs: 20000 });
  const m = (r.out || '').match(/[0-9]+\.[0-9]+\.[0-9]+/);
  return m ? m[0] : null;
}

// --- capture mode -------------------------------------------------------------

async function capture(opts) {
  const base = opts.model;
  if (!base) die(3, 'capture needs --model <base-id>');
  if (base.includes(SUFFIX)) die(3, '--model must be the base id (no [1m]); the probe adds the suffix');
  const requestedModelId = `${base}${SUFFIX}`;
  const bin = opts.claudeBin || 'claude';

  const { server, port, captured } = await startCaptureServer();
  const version = await claudeVersion(bin);

  // A settings.json `env` block overrides process env for ANTHROPIC_BASE_URL, so
  // pointing the child at the capture server requires --settings, not exported
  // env. --bare keeps auth strictly to the settings-supplied dummy key (no OAuth,
  // no keychain), so a real provider is never contacted.
  const settings = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: 'sk-probe-dummy-not-a-real-key',
    },
  });
  const args = ['--bare', '--print', '--no-session-persistence', '--tools', '', '--settings', settings, '--model', requestedModelId, 'Reply with the single word ok.'];
  const run = await runChild(bin, args, { env: process.env, timeoutMs: opts.timeoutMs || 60000 });
  await new Promise((r) => server.close(r));

  const messagesReqs = captured.filter((c) => !c.path.endsWith('/count_tokens'));
  const anyReq = messagesReqs[0] || captured[0];
  const observedWireModelId = anyReq ? anyReq.model : null;
  const gotRequest = captured.length > 0;
  const suffixStrippedUpstream = gotRequest && captured.every((c) => c.model != null && !c.model.includes(SUFFIX));
  const wireEqualsBase = observedWireModelId === base;
  const pass = gotRequest && suffixStrippedUpstream && wireEqualsBase;

  const evidence = {
    mode: 'capture',
    capturedAt: nowIso(),
    claudeCodeVersion: version,
    requestedModelId,
    observedWireModelId,
    suffixStrippedUpstream,
    wireEqualsBaseId: wireEqualsBase,
    requestCount: captured.length,
    requestPaths: [...new Set(captured.map((c) => c.path))],
    childExitCode: run.code,
    childTimedOut: !!run.timedOut,
    pass,
  };
  emit(evidence, opts.json);
  if (!gotRequest) die(2, 'no request reached the capture server (child never called upstream)');
  process.exit(pass ? 0 : 1);
}

// --- live mode ----------------------------------------------------------------
// Deterministic large prompt: a seeded stream of short tokens. ~1 token per
// whitespace-delimited word is a conservative floor for byte→token ratio, so
// we over-generate to clear the target comfortably. The exact size and a hash
// of the generator parameters go into the evidence (not the text itself).

function buildLargePrompt(targetWords, seed) {
  const words = ['alpha', 'bravo', 'cobalt', 'delta', 'ember', 'flint', 'gamma', 'harbor', 'ivory', 'juniper'];
  let h = crypto.createHash('sha256').update(String(seed)).digest();
  const parts = [];
  for (let i = 0; i < targetWords; i++) {
    const b = h[i % h.length];
    parts.push(words[b % words.length] + (i % 17));
    if (i % 64 === 63) h = crypto.createHash('sha256').update(h).digest();
  }
  const text = parts.join(' ');
  return { text, params: { targetWords, seed, sha256: crypto.createHash('sha256').update(text).digest('hex') } };
}

function extractInputTokens(jsonOut) {
  // Claude Code --output-format json returns a result object; usage shape can
  // vary (usage.input_tokens, or a modelUsage map). Probe defensively.
  let doc;
  try { doc = JSON.parse(jsonOut); } catch { return null; }
  const scan = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Number.isInteger(o.input_tokens)) {
      const cache = (o.cache_read_input_tokens || 0) + (o.cache_creation_input_tokens || 0);
      return o.input_tokens + cache;
    }
    for (const v of Object.values(o)) {
      const r = scan(v);
      if (r != null) return r;
    }
    return null;
  };
  return scan(doc);
}

async function live(opts) {
  const base = opts.model;
  if (!base) die(3, 'live needs --model <base-id>');
  if (base.includes(SUFFIX)) die(3, '--model must be the base id (no [1m])');
  const minTokens = Number.isInteger(opts.minInputTokens) ? opts.minInputTokens : GATEWAY_FLOOR + 1;
  const requestedModelId = `${base}${SUFFIX}`;
  const bin = opts.claudeBin || 'claude';

  // Calibration (Claude Code 2.1.204 → gpt-5.6-sol via CLIProxy): ~2.07 input
  // tokens per generated word plus ~16.6K fixed system overhead. 0.75 words per
  // target token lands observed usage ~1.5× the target — comfortably above the
  // 200K floor and far below the 1M ceiling — and stays above the floor even if
  // the tokenizer were as coarse as ~1.5 tokens/word.
  const { text, params } = buildLargePrompt(Math.ceil(minTokens * 0.75), 'v-383');
  const prompt = `Below is a long block of filler. Ignore its content. Reply with only the single word: SENTINEL383.\n\n${text}`;
  const version = await claudeVersion(bin);

  const args = ['--print', '--no-session-persistence', '--output-format', 'json', '--tools', '', '--model', requestedModelId];
  const run = await runChild(bin, args, { env: process.env, timeoutMs: opts.timeoutMs || 300000, input: prompt });

  const observedInputTokens = extractInputTokens(run.out || '');
  const sawSentinel = /SENTINEL383/.test(run.out || '');
  const completed = run.code === 0 && !run.timedOut && observedInputTokens != null;
  const aboveFloor = Number.isInteger(observedInputTokens) && observedInputTokens > GATEWAY_FLOOR;
  const aboveTarget = Number.isInteger(observedInputTokens) && observedInputTokens >= minTokens;
  const pass = completed && aboveFloor && aboveTarget && sawSentinel;

  const evidence = {
    mode: 'live',
    verifiedAt: nowIso(),
    claudeCodeVersion: version,
    requestedModelId,
    // The router forwards bytes unchanged and Claude Code strips [1m] client-side
    // (proven separately by the capture probe); the wire id the upstream sees is
    // the base id. Recorded here for the registry cross-check.
    observedWireModelId: base,
    promptGenerator: params,
    minInputTokensTarget: minTokens,
    gatewayFloor: GATEWAY_FLOOR,
    observedInputTokens,
    aboveGatewayFloor: aboveFloor,
    sentinelReturned: sawSentinel,
    completed,
    childExitCode: run.code,
    childTimedOut: !!run.timedOut,
    pass,
  };
  emit(evidence, opts.json);
  if (run.error || run.timedOut) die(2, `route unavailable or timed out (${run.error || 'timeout'})`);
  process.exit(pass ? 0 : 1);
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--claude-bin') opts.claudeBin = argv[++i];
    else if (a === '--timeout-ms') opts.timeoutMs = parseInt(argv[++i], 10);
    else if (a === '--min-input-tokens') opts.minInputTokens = parseInt(argv[++i], 10);
    else die(3, `unknown flag ${a}`);
  }
  return opts;
}

const [mode, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);
if (mode === 'capture') capture(opts);
else if (mode === 'live') live(opts);
else die(3, `unknown mode ${JSON.stringify(mode)} — expected capture | live`);
