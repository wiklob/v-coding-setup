#!/usr/bin/env node
// Tests for session-review.mjs — the V-5 post-session review engine. Proves both
// lenses fire on a synthetic transcript and that emitted strings are redacted.
// Run: node bin/session-review.test.mjs   (exit 0 = pass, 1 = fail)

import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyze,
  classifyShape,
  shapeSignature,
  buildReport,
  emitPayloads,
  EMIT_SUPPRESS_LENS_A,
  EMIT_SUPPRESS_LENS_B,
  isAlreadyAllowed,
  isReadOnlyProbe,
  isEphemeralDoc,
} from "./session-review.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

// --- pure-function checks (no fixture) ---------------------------------------
check("shapeSignature: simple read", shapeSignature("git status --porcelain").sig === "git status");
check("shapeSignature: compound chains verbs", (() => {
  const s = shapeSignature("git add . && git commit -m x");
  return s.compound === true && s.sig === "git add && git commit";
})());
check("shapeSignature: launcher picks script basename", shapeSignature("node ~/.claude/bin/foo.mjs read V-5").sig === "node foo.mjs");
check("shapeSignature: quoted op not split", shapeSignature('echo "a && b"').compound === false);

check("classify: compound → Script", classifyShape("git add && git commit", { compound: true, sample: "git add . && git commit -m x" }).bucket === "Script");
check("classify: read verb → Allow", classifyShape("git status", { compound: false, sample: "git status" }).bucket === "Allow");
check("classify: force-push → Deny/Ask", classifyShape("git push", { compound: false, sample: "git push --force origin main" }).bucket === "Deny/Ask");
check("classify: prod migration → Deny/Ask", classifyShape("supabase db", { compound: false, sample: "supabase db push" }).bucket === "Deny/Ask");

// --- V-132: settings-awareness (Lens A/Allow suppression) --------------------
const al = ["Read", "mcp__linear__save_issue", "Bash(*)", "Bash(git *)", "mcp__sentry"];
check("V-132 isAllowed: bare tool name", isAlreadyAllowed("tool:Read", "Read", al) === true);
check("V-132 isAllowed: exact mcp tool", isAlreadyAllowed("tool:mcp__linear__save_issue", "x", al) === true);
check("V-132 isAllowed: Write always dropped (path-scoped)", isAlreadyAllowed("tool:Write", "Write", []) === true);
check("V-132 isAllowed: Edit always dropped (path-scoped)", isAlreadyAllowed("tool:Edit", "Edit", []) === true);
check("V-132 isAllowed: unknown tool not allowed", isAlreadyAllowed("tool:Glob", "Glob", al) === false);
check("V-132 isAllowed: mcp server-prefix grants", isAlreadyAllowed("tool:mcp__sentry__find_issues", "x", al) === true);
check("V-132 isAllowed: Bash blanket *", isAlreadyAllowed("git status", "git status --porcelain", al) === true);
check("V-132 isAllowed: Bash(git *) glob", isAlreadyAllowed("git log", "git log --oneline", ["Bash(git *)"]) === true);
check("V-132 isAllowed: unmatched Bash not allowed", isAlreadyAllowed("docker ps", "docker ps", ["Bash(git *)"]) === false);

// buildReport end-to-end: with an allow-list, already-granted Allow shapes drop;
// a NON-allowed Allow shape survives; allow=[] (default) suppresses nothing.
const synthShapes = new Map([
  ["tool:Read", { count: 5, compound: false, sample: "Read" }],
  ["tool:mcp__linear__save_issue", { count: 4, compound: false, sample: "mcp__linear__save_issue" }],
  ["tool:Write", { count: 3, compound: false, sample: "Write" }],
  ["tool:mcp__linear__list_documents", { count: 2, compound: false, sample: "mcp__linear__list_documents" }],
  ["git status", { count: 3, compound: false, sample: "git status --porcelain" }],
]);
const synthAnalysis = { shapes: synthShapes, toolCounts: {}, lensB: [], meta: { assistant: 1, user: 0 } };
const allowList = ["Read", "mcp__linear__save_issue", "Bash(git *)"];
const suppressed = buildReport(synthAnalysis, { minCount: 2, allow: allowList });
const aShapes = suppressed.lensA.map((r) => r.shape);
check("V-132 buildReport: already-allowed Read suppressed", !aShapes.includes("tool:Read"));
check("V-132 buildReport: already-allowed mcp tool suppressed", !aShapes.includes("tool:mcp__linear__save_issue"));
check("V-132 buildReport: path-scoped Write dropped", !aShapes.includes("tool:Write"));
check("V-132 buildReport: Bash(git *)-covered shape suppressed", !aShapes.includes("git status"));
check("V-132 buildReport: NON-allowed tool still surfaces", aShapes.includes("tool:mcp__linear__list_documents"));
check("V-132 buildReport: only the unallowed survives", suppressed.lensA.length === 1);
// allow=[] ⇒ no settings-driven suppression; only the unconditional Write/Edit drop
// applies (path-scoped, never a blanket-allow candidate), so 4 of 5 survive.
check("V-132 buildReport: allow=[] only drops the path-scoped Write", buildReport(synthAnalysis, { minCount: 2 }).lensA.length === 4);

// --- V-132: Lens B refinement (probe + ephemeral-doc predicates) -------------
check("V-132 isReadOnlyProbe: cat existence-probe", isReadOnlyProbe("cat foo.json 2>/dev/null || echo MISSING") === true);
check("V-132 isReadOnlyProbe: ls probe", isReadOnlyProbe("ls bin/ 2>/dev/null") === true);
check("V-132 isReadOnlyProbe: grep|head probe", isReadOnlyProbe("grep -n foo file 2>/dev/null | head -5") === true);
check("V-132 isReadOnlyProbe: rm is mutating", isReadOnlyProbe("rm -f tmp 2>/dev/null || true") === false);
check("V-132 isReadOnlyProbe: output redirect not a probe", isReadOnlyProbe("cat a 2>/dev/null > out.txt") === false);
check("V-132 isReadOnlyProbe: node is mutating", isReadOnlyProbe("node build.mjs 2>/dev/null || echo fail") === false);
check("V-132 isEphemeralDoc: build plan", isEphemeralDoc("docs/plans/v-132-build.md") === true);
check("V-132 isEphemeralDoc: pr body", isEphemeralDoc("/tmp/foo-pr-body.md") === true);
check("V-132 isEphemeralDoc: changelog", isEphemeralDoc("docs/changelog.md") === true);
check("V-132 isEphemeralDoc: system doc not ephemeral", isEphemeralDoc("docs/architecture.md") === false);

// --- emit payloads (V-60 fix-class line + V-165 emit-worthiness filter) -------
// V-165/V-180: the emit/harvest path keeps ONLY patchable findings — Lens A/Allow +
// Deny/Ask (→ settings.json patches). Everything else is suppressed from the sink
// (still shown by renderMarkdown): the conv-7/8 *pattern* flags (V-165: Lens A/Script,
// Lens B/error-swallow + doc-asserts-state) AND the Lens B correctness *candidates*
// (V-180: failed-then-claimed + fabricated-id? — candidates-not-verdicts, a human read,
// not a committed-artifact patch). So ALL of Lens B is now suppressed from --emit.
const emitFixture = emitPayloads({
  lensA: [
    { shape: "git status", count: 4, bucket: "Allow", reason: "recurring read-only verb — safe to blanket-allow" },
    { shape: "git add && git commit", count: 3, bucket: "Script", reason: "compound multi-step command — script it" },
    { shape: "git push", count: 2, bucket: "Deny/Ask", reason: "sensitive / prod-mutating — wants a gate" },
  ],
  lensB: [
    { type: "error-swallow", msg: 6, detail: "rm -f tmp 2>/dev/null || true" },
    { type: "doc-asserts-state", msg: 9, detail: "architecture.md: now deployed" },
    { type: "failed-then-claimed", msg: 12, detail: "claimed done after error" },
    { type: "fabricated-id?", msg: 14, detail: 'unseen id "PR #99"' },
  ],
});
check("V-165 emit: Script suppressed (conv 7, non-patchable)", !emitFixture.some((p) => p.startsWith("[lens-a/Script]")));
check("V-165 emit: error-swallow suppressed (conv 8)", !emitFixture.some((p) => p.startsWith("[lens-b/error-swallow]")));
check("V-165 emit: doc-asserts-state suppressed (conv 8)", !emitFixture.some((p) => p.startsWith("[lens-b/doc-asserts-state]")));
check("V-165 emit: Allow kept (→ settings.json patch)", emitFixture.includes("[lens-a/Allow] git status ×4 — recurring read-only verb — safe to blanket-allow"));
check("V-165 emit: Deny/Ask kept (→ gate)", emitFixture.some((p) => p.startsWith("[lens-a/Deny/Ask]")));
check("V-180 emit: failed-then-claimed suppressed (correctness candidate → human read, not a patch)", !emitFixture.some((p) => p.startsWith("[lens-b/failed-then-claimed]")));
check("V-180 emit: fabricated-id? suppressed (correctness candidate → human read, not a patch)", !emitFixture.some((p) => p.startsWith("[lens-b/fabricated-id?]")));
check("V-180 emit: only the 2 patchable Lens A findings survive (all Lens B suppressed)", emitFixture.length === 2);
check("V-165 emit: Lens A still leads with fix-class + count", emitFixture[0] === "[lens-a/Allow] git status ×4 — recurring read-only verb — safe to blanket-allow");
check("emit: empty report → no payloads", emitPayloads({ lensA: [], lensB: [] }).length === 0);
check(
  "V-180 policy: Lens A suppresses only Script; Lens B suppresses all four types (conv-7/8 flags + correctness candidates)",
  EMIT_SUPPRESS_LENS_A.has("Script") &&
    !EMIT_SUPPRESS_LENS_A.has("Allow") &&
    EMIT_SUPPRESS_LENS_B.has("error-swallow") &&
    EMIT_SUPPRESS_LENS_B.has("doc-asserts-state") &&
    EMIT_SUPPRESS_LENS_B.has("failed-then-claimed") &&
    EMIT_SUPPRESS_LENS_B.has("fabricated-id?")
);

// --- streaming-analysis checks (synthetic transcript) ------------------------
// Two recurring shapes: a compound git chain ×2 (→ Script) and `git status` ×2
// (→ Allow). One error-swallowing Bash. A failed tool_result immediately followed
// by an assistant success claim with NO retry tool_use (→ failed-then-claimed). A
// Write to a .md asserting external state (→ doc-asserts-state). A planted secret in
// a command must be redacted out of the report.
const A = (content, ts = "2026-06-01T10:00:00.000Z") =>
  JSON.stringify({ type: "assistant", timestamp: ts, message: { content } });
const U = (content) => JSON.stringify({ type: "user", message: { content } });
const bash = (command) => ({ type: "tool_use", name: "Bash", input: { command } });

const lines = [
  A([bash("git add . && git commit -m one")]),
  A([bash("git add . && git commit -m two")]),
  A([bash("git status --porcelain")]),
  A([bash("git status")]),
  A([bash("rm -f tmp 2>/dev/null || true")]),
  A([bash("export API_TOKEN=sk-supersecretvalue1234567890 && deploy")]),
  A([{ type: "tool_use", name: "Write", input: { file_path: "docs/notes.md", content: "The migration was applied to prod and is now live." } }]),
  "",
  "{ malformed",
  U([{ type: "tool_result", is_error: true, content: "boom: command failed" }]),
  A([{ type: "text", text: "All done — the fix works and is verified." }], "2026-06-01T10:09:00.000Z"),
];

const fixture = join(tmpdir(), `session-review-test-${process.pid}.jsonl`);
writeFileSync(fixture, lines.join("\n") + "\n");

try {
  const analysis = await analyze(fixture);

  const git = analysis.shapes.get("git add && git commit");
  check("Lens A: compound git chain grouped + counted ×2", git?.count === 2 && git?.compound === true);
  check("Lens A: git status grouped ×2", analysis.shapes.get("git status")?.count === 2);

  const swallow = analysis.lensB.filter((f) => f.type === "error-swallow");
  check("Lens B: error-swallow detected", swallow.length === 1);
  const ftc = analysis.lensB.filter((f) => f.type === "failed-then-claimed");
  check("Lens B: failed-then-claimed detected", ftc.length === 1);
  const docs = analysis.lensB.filter((f) => f.type === "doc-asserts-state");
  check("Lens B: doc-asserts-state detected", docs.length === 1);

  const report = buildReport(analysis, { minCount: 2 });
  const blob = JSON.stringify(report);
  check("report: both lenses non-empty (real candidates)", report.lensA.length >= 2 && report.lensB.length >= 3);
  check("report: planted secret is redacted out", !blob.includes("sk-supersecretvalue1234567890"));
  check("report: compound shape bucketed Script", report.lensA.find((r) => r.shape === "git add && git commit")?.bucket === "Script");
  check("report: git status bucketed Allow", report.lensA.find((r) => r.shape === "git status")?.bucket === "Allow");
} finally {
  try {
    unlinkSync(fixture);
  } catch {
    /* ignore */
  }
}

// --- V-132: Lens B negatives over a real streaming pass ----------------------
// A read-only existence-probe must NOT trip error-swallow (a mutating swallow still
// does); an ephemeral build-plan write must NOT trip doc-asserts-state (a System
// doc still does).
const v132lines = [
  A([bash("cat config.json 2>/dev/null || echo MISSING")]),
  A([bash("rm -rf build 2>/dev/null || true")]),
  A([{ type: "tool_use", name: "Write", input: { file_path: "docs/plans/v-132-build.md", content: "Status: deployed and now live in prod." } }]),
  A([{ type: "tool_use", name: "Write", input: { file_path: "docs/architecture.md", content: "The worker is now deployed and live." } }]),
];
const v132fixture = join(tmpdir(), `session-review-v132-${process.pid}.jsonl`);
writeFileSync(v132fixture, v132lines.join("\n") + "\n");

try {
  const a2 = await analyze(v132fixture);
  const sw = a2.lensB.filter((f) => f.type === "error-swallow");
  check("V-132 analyze: read-only probe not flagged, mutating swallow is", sw.length === 1 && /rm -rf/.test(sw[0].detail));
  const dc = a2.lensB.filter((f) => f.type === "doc-asserts-state");
  check("V-132 analyze: ephemeral build-plan not flagged, system doc is", dc.length === 1 && /architecture/.test(dc[0].detail));
} finally {
  try {
    unlinkSync(v132fixture);
  } catch {
    /* ignore */
  }
}

console.log(fails === 0 ? "\nAll tests passed." : `\n${fails} test(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);
