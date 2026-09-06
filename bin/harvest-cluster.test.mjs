#!/usr/bin/env node
// Tests for harvest-cluster.mjs — route classification, normalization,
// deterministic keying, and root-cause clustering. (V-429)
// Run: node bin/harvest-cluster.test.mjs   (exit 0 = pass, 1 = fail)

import {
  isManualShaped,
  classifyRoute,
  normalizeError,
  computeHarvestKey,
  pickRepresentative,
  buildClusters,
} from "./harvest-cluster.mjs";

let fails = 0;
function check(name, cond) {
  console.log(`[${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails++;
}

// --- §2 manual-shaped detector + route table ---------------------------------

check("hook: real tool + input", isManualShaped({ tool: "Bash", input: { command: "ls" } }) === false);
check("manual: tool === manual", isManualShaped({ tool: "manual" }) === true);
check("manual: no input field (real tool)", isManualShaped({ tool: "go", error: "x" }) === true);

check(
  "route hook: real tool + input",
  classifyRoute({ tool: "Bash", input: { command: "ls" }, error: "x" }) === "hook",
);
check(
  "route human: manual-shaped, activeCommand report-bug",
  classifyRoute({ tool: "manual", activeCommand: "report-bug", error: "x" }) === "human",
);
check(
  "route human: --tool override still manual-shaped by no-input",
  classifyRoute({ tool: "go", activeCommand: "report-bug", error: "x" }) === "human",
);
check(
  "route review: manual-shaped, activeCommand review-session",
  classifyRoute({ tool: "manual", activeCommand: "review-session", error: "[lens-a/Allow] x ×2 — y" }) === "review",
);
check(
  "route self-report: manual-shaped, any other activeCommand",
  classifyRoute({ tool: "manual", activeCommand: "plan", error: "x" }) === "self-report",
);
check(
  "hook wins even during a report-bug session (real tool + input)",
  classifyRoute({ tool: "Bash", activeCommand: "report-bug", input: { command: "ls" }, error: "x" }) === "hook",
);

// --- §4a normalization --------------------------------------------------------

check(
  "strips leading Exit code preamble",
  normalizeError("Exit code 1\nsomething broke") === "something broke",
);
check(
  "collapses absolute paths to a placeholder",
  normalizeError("failed at /Users/someone/.claude/bin/foo.mjs") === "failed at <PATH>",
);
check(
  "collapses ISO timestamps",
  normalizeError("at 2026-08-02T07:07:42.122Z it broke") === "at <TS> it broke",
);
check(
  "collapses line/column words",
  normalizeError("error at line 20 column 6113") === "error at line <N> column <N>",
);
check(
  "collapses inline file:line:col",
  normalizeError("decoder.py:20:5: bad token") === "decoder.py:<LOC>: bad token",
);
check(
  "collapses branch phrase",
  normalizeError("on branch flingelms30/v-429-fix pushed") === "on branch <BRANCH> pushed",
);
check(
  "collapses «redacted» token",
  normalizeError("token «redacted» rejected") === "token <REDACTED> rejected",
);
check(
  "collapses whitespace and trims",
  normalizeError("  a   b\n\nc  ") === "a b c",
);
check("undefined error normalizes to empty string", normalizeError(undefined) === "");

// Lens A: strip only the ×<count>, keep bucket/shape/reason.
check(
  "lens-a strips ×<count>, keeps reason",
  normalizeError("[lens-a/Allow] Bash(rg) ×3 — safe read-only search") ===
    "[lens-a/Allow] Bash(rg) — safe read-only search",
);
check(
  "lens-a with different counts normalizes identically",
  normalizeError("[lens-a/Allow] Bash(rg) ×3 — safe read-only search") ===
    normalizeError("[lens-a/Allow] Bash(rg) ×11 — safe read-only search"),
);

// Lens B: key on the [lens-b/<type>] tag alone — msg# and trailing detail both go.
check(
  "lens-b collapses to the bare tag",
  normalizeError("[lens-b/error-swallow] msg#12 — swallowed a 400 body here") === "[lens-b/error-swallow]",
);
check(
  "lens-b with different msg# and detail normalizes identically",
  normalizeError("[lens-b/error-swallow] msg#12 — detail A") ===
    normalizeError("[lens-b/error-swallow] msg#99 — a totally different detail"),
);

// --- §4a volatile-only variance still clusters together (acceptance item 2) --

const a1 = {
  tool: "Bash",
  activeCommand: "harvest-pipeline-bugs",
  origin: ".claude",
  session: "s1",
  conversation: "c1",
  ts: "2026-08-02T07:07:42.122Z",
  input: { command: "python3 -c ..." },
  error: "Exit code 1\nfailed at /Users/someone/.claude/bin/foo.mjs:20:5 on branch flingelms30/v-429-fix",
};
const a2 = {
  tool: "Bash",
  activeCommand: "harvest-pipeline-bugs",
  origin: ".claude",
  session: "s2",
  conversation: "c2",
  ts: "2026-08-03T09:00:00.000Z",
  input: { command: "python3 -c ..." },
  error: "Exit code 1\nfailed at /Users/someone/other/path/bar.mjs:99:1 on branch someone/other-fix",
};
check(
  "acceptance: path/ts/loc/branch-only variance yields the same normalized text",
  normalizeError(a1.error) === normalizeError(a2.error),
);
check(
  "acceptance: same normalized error, same route -> identical harvest-key",
  computeHarvestKey(classifyRoute(a1), normalizeError(a1.error)) ===
    computeHarvestKey(classifyRoute(a2), normalizeError(a2.error)),
);

// --- §4b determinism: same input -> byte-identical key, twice -------------

const rerun1 = computeHarvestKey("hook", normalizeError(a1.error));
const rerun2 = computeHarvestKey("hook", normalizeError(a1.error));
check("harvest-key is deterministic across repeated runs", rerun1 === rerun2);
check("harvest-key shape is <route>:<8-hex>", /^hook:[0-9a-f]{8}$/.test(rerun1));

// Distinct problems must NOT collide.
check(
  "distinct normalized errors get distinct keys",
  computeHarvestKey("hook", normalizeError("problem one")) !==
    computeHarvestKey("hook", normalizeError("problem two")),
);

// --- pickRepresentative: prefers input, then most specific (longest) error --

check(
  "prefers the entry with input over one without",
  pickRepresentative([{ error: "short" }, { input: { command: "x" }, error: "y" }]).input !== undefined,
);
check(
  "among input-bearing entries, prefers the longest/most specific error",
  pickRepresentative([
    { input: { command: "x" }, error: "short" },
    { input: { command: "x" }, error: "a much more specific and detailed error message" },
  ]).error === "a much more specific and detailed error message",
);
check(
  "falls back to longest error when none carry input",
  pickRepresentative([{ error: "a" }, { error: "bb" }]).error === "bb",
);

// --- buildClusters: root-cause clustering, tool/activeCommand not dividers --

const entries = [
  a1,
  a2,
  {
    tool: "Grep",
    activeCommand: "plan",
    origin: "myapp",
    session: "s3",
    conversation: null,
    ts: "2026-08-04T00:00:00.000Z",
    input: { command: "rg foo" },
    error: "Exit code 1\nfailed at /Users/someone/x/y.mjs:1:1 on branch other/branch-name",
  },
  {
    tool: "manual",
    activeCommand: "report-bug",
    origin: null,
    session: "s4",
    conversation: "s4",
    ts: "2026-08-05T00:00:00.000Z",
    error: "a wholly unrelated human-reported problem",
  },
];

const clusters = buildClusters(entries);
check("clusters into 2 distinct root causes (3 hook occurrences + 1 human)", clusters.length === 2);

const hookCluster = clusters.find((c) => c.route === "hook");
check("hook cluster exists", hookCluster !== undefined);
check(
  "acceptance: same normalized error clusters across different tool/activeCommand/origin",
  hookCluster.count === 3,
);
check(
  "tool is evidence, not a divider — both Bash and Grep land in one cluster",
  hookCluster.tools.includes("Bash") && hookCluster.tools.includes("Grep") && hookCluster.tools.length === 2,
);
check(
  "activeCommand is evidence, not a divider — one cluster, two commands",
  hookCluster.activeCommands.includes("harvest-pipeline-bugs") && hookCluster.activeCommands.includes("plan"),
);
check("origins collected distinct", hookCluster.origins.includes(".claude") && hookCluster.origins.includes("myapp"));
check("ts is a parallel per-entry list, one per occurrence", hookCluster.ts.length === 3);
check("sessions is a parallel per-entry list", hookCluster.sessions.length === 3);
check("conversations is a parallel per-entry list (nulls kept)", hookCluster.conversations.length === 3);
check(
  "representative picked by richness (has input + longest error) among the cluster",
  hookCluster.representative.input !== undefined,
);
check(
  "harvest-key matches the <route>:<hash> shape",
  /^hook:[0-9a-f]{8}$/.test(hookCluster.harvestKey),
);

const humanCluster = clusters.find((c) => c.route === "human");
check("human cluster exists and is separate from hook", humanCluster !== undefined && humanCluster.count === 1);

check("clusters are sorted by harvestKey for a stable rerun", clusters.every((c, i) => i === 0 || clusters[i - 1].harvestKey <= c.harvestKey));

// --- buildClusters: rerun determinism (byte-identical) -----------------------

const rerunClusters = buildClusters(entries);
check(
  "rerunning buildClusters over the same input is byte-identical",
  JSON.stringify(clusters) === JSON.stringify(rerunClusters),
);

// --- empty input --------------------------------------------------------------

check("empty input yields no clusters", buildClusters([]).length === 0);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
