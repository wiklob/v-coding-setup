#!/usr/bin/env node
// Tests for advance-docs-refresh-watermark.mjs (V-284; per-repo watermark V-375).
// Run: node --test bin/advance-docs-refresh-watermark.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { parseFlags, formatWatermark, resolveWatermarkPath, validateRepoRoot, ownRepoRoot } from "./advance-docs-refresh-watermark.mjs";

test("parseFlags reads --commit and --repo-root", () => {
  assert.deepEqual(parseFlags(["--commit", "abc1234"]), { commit: "abc1234" });
  assert.deepEqual(parseFlags(["--commit", "abc1234", "--repo-root", "/x/y"]), { commit: "abc1234", repoRoot: "/x/y" });
  assert.deepEqual(parseFlags([]), {});
});

test("formatWatermark accepts a valid short SHA (lowercased, newline-terminated)", () => {
  assert.equal(formatWatermark("ABC1234"), "abc1234\n");
  assert.equal(formatWatermark("  deadbeef  "), "deadbeef\n");
  assert.equal(formatWatermark("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"), "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\n");
});

test("formatWatermark rejects non-SHA / missing input (→ null, caller exits 2)", () => {
  assert.equal(formatWatermark(undefined), null);        // required, no default
  assert.equal(formatWatermark(""), null);
  assert.equal(formatWatermark("main"), null);            // a ref name, not a SHA
  assert.equal(formatWatermark("xyz"), null);             // too short + non-hex
  assert.equal(formatWatermark("g1b2c3d"), null);         // non-hex char
  assert.equal(formatWatermark("123456"), null);          // 6 chars < 7 floor
  assert.equal(formatWatermark(1234567), null);           // not a string
});

test("resolveWatermarkPath defaults to this file's own checkout when no root is given", () => {
  const p = resolveWatermarkPath();
  assert.ok(p.endsWith("/pipeline/audit/.docs-refresh-watermark"), p);
  assert.ok(!p.includes("/bin/"), "resolves out of bin/ to the repo root");
  assert.equal(p, join(ownRepoRoot(), "pipeline", "audit", ".docs-refresh-watermark"));
});

test("resolveWatermarkPath keys off the passed repo root — two roots never collide (V-375 invariant)", () => {
  const rootA = "/tmp/repo-a";
  const rootB = "/tmp/repo-b";
  const pA = resolveWatermarkPath(rootA);
  const pB = resolveWatermarkPath(rootB);
  assert.equal(pA, "/tmp/repo-a/pipeline/audit/.docs-refresh-watermark");
  assert.equal(pB, "/tmp/repo-b/pipeline/audit/.docs-refresh-watermark");
  assert.notEqual(pA, pB, "distinct repo roots must resolve to distinct watermark files");
});

test("validateRepoRoot: absolute existing dir passes; relative/missing/omitted handled", () => {
  const real = mkdtempSync(join(tmpdir(), "wm-root-"));
  assert.equal(validateRepoRoot(real), real, "absolute existing dir is accepted verbatim");
  assert.equal(validateRepoRoot(undefined), undefined, "omitted → default (not an error)");
  assert.equal(validateRepoRoot("relative/path"), null, "relative path rejected");
  assert.equal(validateRepoRoot("/no/such/dir/here/xyz"), null, "non-existent path rejected");
  assert.equal(validateRepoRoot(1234), null, "non-string rejected");
});
