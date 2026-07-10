#!/usr/bin/env node
// Tests for advance-docs-refresh-watermark.mjs (V-284). Run: node --test bin/advance-docs-refresh-watermark.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlags, formatWatermark, resolveWatermarkPath } from "./advance-docs-refresh-watermark.mjs";

test("parseFlags reads --commit", () => {
  assert.deepEqual(parseFlags(["--commit", "abc1234"]), { commit: "abc1234" });
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

test("resolveWatermarkPath points at the canonical checkout's pipeline/audit dir", () => {
  const p = resolveWatermarkPath();
  assert.ok(p.endsWith("/pipeline/audit/.docs-refresh-watermark"), p);
  assert.ok(!p.includes("/bin/"), "resolves out of bin/ to the repo root");
});
