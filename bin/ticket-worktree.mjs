#!/usr/bin/env node
// Deterministic ticket-worktree layout + private binding state. (V-372)
//
// Ordinary repositories use <sourceRoot>/.claude/worktrees/<existing-name> so
// EnterWorktree recognizes them as managed. The installed legacy source checkout
// at ~/.claude stays on its sibling layout until V-376 cuts source ownership over.
// Binding JSON lives in the linked worktree's private Git directory, never in the
// protected checkout .claude/ tree.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BINDING_FILE = "claude-ticket-flow.json";
const LEGACY_BINDING = join(".claude", "active-project.json");

function canonicalPath(path) {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "git command failed").trim();
    throw new Error(detail);
  }
  return result.stdout.trim();
}

function sanitize(value, { lowercase = false, limit } = {}) {
  let out = String(value ?? "");
  if (lowercase) out = out.toLowerCase();
  out = out.replace(/[^A-Za-z0-9]+/g, "-").replace(/-+$/, "");
  if (limit) out = out.slice(0, limit);
  if (!out) throw new Error("worktree name segment is empty after sanitization");
  return out;
}

export function worktreeName({ sourceRoot, mode, project, issue, milestone }) {
  const repo = sanitize(basename(resolve(sourceRoot)));
  if (mode === "standalone") {
    return `${repo}-wt-${sanitize(issue, { lowercase: true })}`;
  }
  if (mode === "feature") {
    return `${repo}-wt-${sanitize(project, { limit: 40 })}`;
  }
  if (mode === "milestone") {
    return `${repo}-wt-${sanitize(project, { lowercase: true, limit: 40 })}-${sanitize(milestone, { lowercase: true, limit: 40 })}`;
  }
  throw new Error(`unsupported worktree mode: ${mode}`);
}

export function resolveLayout({ sourceRoot, mode, project, issue, milestone, home = homedir() }) {
  const root = canonicalPath(sourceRoot);
  const name = worktreeName({ sourceRoot: root, mode, project, issue, milestone });
  const managedPath = join(root, ".claude", "worktrees", name);
  const legacyPath = join(dirname(root), name);
  const legacySource = root === resolve(home, ".claude");
  return {
    sourceRoot: root,
    name,
    managedPath,
    legacyPath,
    preferredPath: legacySource ? legacyPath : managedPath,
    layout: legacySource ? "legacy-source" : "managed",
  };
}

function absoluteGitPath(worktree, key) {
  return git(["-C", resolve(worktree), "rev-parse", "--path-format=absolute", "--git-path", key]);
}

function gitDir(worktree) {
  return git(["-C", resolve(worktree), "rev-parse", "--path-format=absolute", "--git-dir"]);
}

function commonGitDir(worktree) {
  return git(["-C", resolve(worktree), "rev-parse", "--path-format=absolute", "--git-common-dir"]);
}

export function bindingPath(worktree) {
  const wt = resolve(worktree);
  const privateDir = resolve(gitDir(wt));
  const commonDir = resolve(commonGitDir(wt));
  if (privateDir === commonDir) {
    throw new Error(`refusing to bind primary worktree: ${wt}`);
  }
  return absoluteGitPath(wt, BINDING_FILE);
}

export function legacyBindingPath(worktree) {
  return join(resolve(worktree), LEGACY_BINDING);
}

function validateBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("binding must be a JSON object");
  }
  if (value.mode === "standalone") {
    if (typeof value.linearIssue !== "string" || !value.linearIssue) {
      throw new Error("standalone binding requires linearIssue");
    }
    return value;
  }
  if (value.mode === "milestone") {
    if (typeof value.linearProject !== "string" || !value.linearProject || typeof value.linearMilestone !== "string" || !value.linearMilestone) {
      throw new Error("milestone binding requires linearProject and linearMilestone");
    }
    return value;
  }
  if (value.mode !== undefined) {
    throw new Error(`unsupported binding mode: ${value.mode}`);
  }
  if (typeof value.linearProject !== "string" || !value.linearProject) {
    throw new Error("feature binding requires linearProject");
  }
  return value;
}

function parseBindingFile(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`invalid binding JSON at ${path}: ${error.message}`);
  }
  return validateBinding(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function equalBinding(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function writeBindingFile(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function bindingStatus(worktree) {
  const privatePath = bindingPath(worktree);
  const legacyPath = legacyBindingPath(worktree);
  const hasPrivate = existsSync(privatePath);
  const hasLegacy = existsSync(legacyPath);
  if (!hasPrivate && !hasLegacy) return "none";
  if (hasPrivate && !hasLegacy) return "private";
  if (!hasPrivate && hasLegacy) return "legacy";
  try {
    return equalBinding(parseBindingFile(privatePath), parseBindingFile(legacyPath)) ? "both-identical" : "conflict";
  } catch {
    return "conflict";
  }
}

export function readBinding(worktree) {
  const privatePath = bindingPath(worktree);
  if (existsSync(privatePath)) return parseBindingFile(privatePath);
  const legacyPath = legacyBindingPath(worktree);
  if (existsSync(legacyPath)) return parseBindingFile(legacyPath);
  throw new Error(`no ticket-flow binding for ${resolve(worktree)}`);
}

export function writeBinding(worktree, value) {
  const validated = validateBinding(value);
  const privatePath = bindingPath(worktree);
  const legacyPath = legacyBindingPath(worktree);
  if (existsSync(legacyPath) && !equalBinding(parseBindingFile(legacyPath), validated)) {
    throw new Error(`binding conflict between ${legacyPath} and requested payload`);
  }
  writeBindingFile(privatePath, validated);
  return privatePath;
}

export function migrateBinding(worktree) {
  const privatePath = bindingPath(worktree);
  const legacyPath = legacyBindingPath(worktree);
  if (!existsSync(legacyPath)) {
    return { status: existsSync(privatePath) ? "private" : "none", path: privatePath };
  }
  const legacy = parseBindingFile(legacyPath);
  if (existsSync(privatePath)) {
    const current = parseBindingFile(privatePath);
    if (!equalBinding(current, legacy)) {
      throw new Error(`binding conflict between ${privatePath} and ${legacyPath}`);
    }
  } else {
    writeBindingFile(privatePath, legacy);
  }
  rmSync(legacyPath);
  try {
    rmdirSync(dirname(legacyPath));
  } catch (error) {
    if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
  }
  return { status: "migrated", path: privatePath };
}

export function prepareWorktreeParent(worktreePath) {
  const parent = dirname(resolve(worktreePath));
  mkdirSync(parent, { recursive: true });
  return parent;
}

export function listWorktreePaths(sourceRoot) {
  const output = git(["-C", resolve(sourceRoot), "worktree", "list", "--porcelain", "-z"]);
  return output.split("\0").filter((entry) => entry.startsWith("worktree ")).map((entry) => canonicalPath(entry.slice("worktree ".length)));
}

function isWithin(path, parent) {
  const rel = relative(resolve(parent), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function moveLegacyWorktree({ sourceRoot, legacyPath, managedPath, cwd = process.cwd() }) {
  const root = canonicalPath(sourceRoot);
  const legacy = canonicalPath(legacyPath);
  const managed = resolve(managedPath);
  if (isWithin(canonicalPath(cwd), legacy)) {
    return { status: "deferred-current-worktree", path: legacy };
  }
  const registered = listWorktreePaths(root);
  if (!registered.includes(legacy)) throw new Error(`legacy worktree is not registered: ${legacy}`);
  if (registered.includes(managed)) throw new Error(`managed worktree is already registered: ${managed}`);
  if (existsSync(managed)) throw new Error(`managed worktree target exists on disk: ${managed}`);
  mkdirSync(dirname(managed), { recursive: true });
  git(["-C", root, "worktree", "move", legacy, managed]);
  return { status: "moved", path: managed };
}

export function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    flags[arg.slice(2)] = argv[++i];
  }
  return flags;
}

function required(flags, name) {
  if (!flags[name]) throw new Error(`--${name} is required`);
  return flags[name];
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  let result;
  if (command === "resolve") {
    result = resolveLayout({
      sourceRoot: required(flags, "root"),
      mode: required(flags, "mode"),
      project: flags.project,
      issue: flags.issue,
      milestone: flags.milestone,
    });
  } else if (command === "prepare-parent") {
    result = { status: "ready", path: prepareWorktreeParent(required(flags, "path")) };
  } else if (command === "binding-path") {
    process.stdout.write(`${bindingPath(required(flags, "worktree"))}\n`);
    return;
  } else if (command === "binding-status") {
    process.stdout.write(`${bindingStatus(required(flags, "worktree"))}\n`);
    return;
  } else if (command === "read-binding") {
    result = readBinding(required(flags, "worktree"));
  } else if (command === "write-binding") {
    const value = JSON.parse(required(flags, "json"));
    result = { status: "written", path: writeBinding(required(flags, "worktree"), value) };
  } else if (command === "migrate-binding") {
    result = migrateBinding(required(flags, "worktree"));
  } else if (command === "move-legacy") {
    result = moveLegacyWorktree({
      sourceRoot: required(flags, "root"),
      legacyPath: required(flags, "legacy"),
      managedPath: required(flags, "managed"),
    });
  } else {
    throw new Error("usage: ticket-worktree.mjs <resolve|prepare-parent|binding-path|binding-status|read-binding|write-binding|migrate-binding|move-legacy> [flags]");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1]?.endsWith("ticket-worktree.mjs");
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`ticket-worktree: ${error.message}\n`);
    process.exit(2);
  }
}
