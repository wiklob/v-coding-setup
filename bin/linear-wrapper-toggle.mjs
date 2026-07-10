#!/usr/bin/env node
// ~/.claude/bin/linear-wrapper-toggle.mjs
//
// Flag system for the self-hosted Linear MCP wrapper (V-107). Lets you route the
// `linear` MCP server to the self-hosted wrapper or the hosted endpoint, with a
// settable GLOBAL DEFAULT (the "flag of flags") plus PER-PATH overrides that win
// over the default. Edits ~/.claude.json — the file Claude Code reads MCP config
// from — never a committed repo file.
//
// Why this shape (not one env-gated .mcp.json): the hosted endpoint authenticates
// via OAuth (no Authorization header) while the wrapper needs a static
// `Authorization: Bearer ${MCP_BEARER_TOKEN}` header. A single JSON entry cannot
// include the header for one and omit it for the other, so the two must be
// SEPARATE entries in separate scopes. Claude Code MCP precedence is
// Local > Project > User, so:
//   - User scope  (mcpServers.linear)                  = the global default
//   - Local scope (projects[<path>].mcpServers.linear) = a per-path override
// A per-path override beats the default for sessions rooted at that path; every
// other session falls through to the default. That is the per-session isolation.
//
// MCP config is read at SESSION START — a toggle takes effect on the NEXT session
// rooted at the affected path, never the running one (no hot reload).
//
// Safety: this rewrites a live, harness-managed file. Before every write it makes
// a timestamped backup, writes to a temp file, re-parses it to prove validity,
// then atomically renames over the original. Run toggles when other sessions are
// idle (a concurrent harness write between our read and rename would be lost;
// the backup is the recovery).
//
// Usage:
//   linear-wrapper-toggle status                 # show default + overrides + resolved-for-cwd
//   linear-wrapper-toggle default wrapper|hosted # set the GLOBAL default (User scope)
//   linear-wrapper-toggle use wrapper|hosted [path]  # per-path override (path default = git root of cwd)
//   linear-wrapper-toggle clear [path]           # remove a per-path override (revert that path to default)
//
// "always wrapper"  = default wrapper          (+ no overrides)
// "always normal"   = default hosted           (+ no overrides)
// "flag system"     = default hosted + `use wrapper <path>` per opt-in path
//                     (or default wrapper + `use hosted <path>` to opt specific paths out)

import { readFileSync, writeFileSync, copyFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG = join(homedir(), ".claude.json");

const HOSTED = { type: "http", url: "https://mcp.linear.app/mcp" };
// The self-hosted wrapper's URL is deployment-specific — set LINEAR_MCP_WRAPPER_URL
// (e.g. in ~/.claude/.envrc) to your linear-mcp-lean endpoint, e.g. https://linear-mcp.example.com/mcp.
const WRAPPER = {
  type: "http",
  url: process.env.LINEAR_MCP_WRAPPER_URL ?? null,
  headers: { Authorization: "Bearer ${MCP_BEARER_TOKEN}" },
};

const MODES = { wrapper: WRAPPER, hosted: HOSTED };

function die(msg) {
  console.error(`linear-wrapper-toggle: ${msg}`);
  process.exit(1);
}

function requireModeConfigured(mode) {
  if (mode === "wrapper" && !WRAPPER.url)
    die(
      "LINEAR_MCP_WRAPPER_URL is not set — export your linear-mcp-lean endpoint " +
        "(e.g. https://linear-mcp.example.com/mcp) before selecting wrapper mode",
    );
}

function readConfig() {
  let raw;
  try {
    raw = readFileSync(CONFIG, "utf8");
  } catch (e) {
    die(`cannot read ${CONFIG}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(`${CONFIG} is not valid JSON (${e.message}) — refusing to touch it`);
  }
}

// Atomic, validated, backed-up write of the whole config object.
function writeConfig(obj) {
  const serialized = JSON.stringify(obj, null, 2);
  // Prove the serialization round-trips before we risk the real file.
  JSON.parse(serialized);
  // Backup time string without Date.now()/new Date() ergonomics issues:
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${CONFIG}.bak-${stamp}`;
  copyFileSync(CONFIG, bak);
  const tmp = `${CONFIG}.tmp-${process.pid}`;
  writeFileSync(tmp, serialized);
  JSON.parse(readFileSync(tmp, "utf8")); // belt-and-suspenders: temp is valid on disk
  renameSync(tmp, CONFIG);
  return bak;
}

// Classify a server entry as one of our known modes (or "custom"/"none").
function classify(entry) {
  if (!entry) return "none";
  if (entry.url === WRAPPER.url) return "wrapper";
  if (entry.url === HOSTED.url) return "hosted";
  return "custom";
}

function gitRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function resolvedFor(cfg, path) {
  const override = cfg.projects?.[path]?.mcpServers?.linear;
  if (override) return { scope: "override", mode: classify(override) };
  const def = cfg.mcpServers?.linear;
  return { scope: "default", mode: classify(def) };
}

function warnIfNoBearer(mode) {
  if (mode === "wrapper" && !process.env.MCP_BEARER_TOKEN) {
    console.warn(
      "  ⚠ MCP_BEARER_TOKEN is not set in this environment. The wrapper entry uses\n" +
        "    ${MCP_BEARER_TOKEN}; if it is unset at session start the `linear` server\n" +
        "    fails to load. Add it to ~/.claude/.envrc and `direnv allow`.",
    );
  }
}

const RESTART_NOTE =
  "  → Restart (or start a new) session rooted at the affected path for this to take effect.";

function cmdStatus() {
  const cfg = readConfig();
  const def = classify(cfg.mcpServers?.linear);
  console.log(`default (all sessions unless overridden): ${def}`);
  const projects = cfg.projects ?? {};
  const overrides = Object.entries(projects)
    .filter(([, v]) => v?.mcpServers?.linear)
    .map(([p, v]) => [p, classify(v.mcpServers.linear)]);
  if (overrides.length) {
    console.log("per-path overrides:");
    for (const [p, m] of overrides) console.log(`  ${m.padEnd(8)} ${p}`);
  } else {
    console.log("per-path overrides: (none)");
  }
  const here = gitRoot();
  const r = resolvedFor(cfg, here);
  console.log(`\ncwd → ${here}\nresolves to: ${r.mode} (via ${r.scope})`);
}

function cmdDefault(mode) {
  if (!MODES[mode]) die(`default expects "wrapper" or "hosted", got "${mode}"`);
  requireModeConfigured(mode);
  const cfg = readConfig();
  cfg.mcpServers = cfg.mcpServers ?? {};
  const prev = classify(cfg.mcpServers.linear);
  cfg.mcpServers.linear = structuredClone(MODES[mode]);
  const bak = writeConfig(cfg);
  console.log(`default: ${prev} → ${mode}   (backup: ${bak})`);
  warnIfNoBearer(mode);
  console.log(RESTART_NOTE);
}

function cmdUse(mode, pathArg) {
  if (!MODES[mode]) die(`use expects "wrapper" or "hosted", got "${mode}"`);
  requireModeConfigured(mode);
  const path = pathArg || gitRoot();
  const cfg = readConfig();
  cfg.projects = cfg.projects ?? {};
  cfg.projects[path] = cfg.projects[path] ?? {};
  cfg.projects[path].mcpServers = cfg.projects[path].mcpServers ?? {};
  const prev = classify(cfg.projects[path].mcpServers.linear);
  cfg.projects[path].mcpServers.linear = structuredClone(MODES[mode]);
  const bak = writeConfig(cfg);
  console.log(`override for ${path}: ${prev} → ${mode}   (backup: ${bak})`);
  warnIfNoBearer(mode);
  console.log(RESTART_NOTE);
}

function cmdClear(pathArg) {
  const path = pathArg || gitRoot();
  const cfg = readConfig();
  const entry = cfg.projects?.[path]?.mcpServers?.linear;
  if (!entry) {
    console.log(`no per-path override for ${path} — nothing to clear`);
    return;
  }
  delete cfg.projects[path].mcpServers.linear;
  // Tidy empty containers we may have created (don't leave stub project entries).
  if (Object.keys(cfg.projects[path].mcpServers).length === 0) delete cfg.projects[path].mcpServers;
  if (Object.keys(cfg.projects[path]).length === 0) delete cfg.projects[path];
  const bak = writeConfig(cfg);
  const def = classify(cfg.mcpServers?.linear);
  console.log(`override for ${path} cleared → now resolves to default (${def})   (backup: ${bak})`);
  console.log(RESTART_NOTE);
}

const [cmd, a, b] = process.argv.slice(2);
switch (cmd) {
  case "status":
  case undefined:
    cmdStatus();
    break;
  case "default":
    cmdDefault(a);
    break;
  case "use":
    cmdUse(a, b);
    break;
  case "clear":
    cmdClear(a);
    break;
  default:
    die(`unknown command "${cmd}". Run with no args (or "status") for the current state; commands: status | default | use | clear`);
}
