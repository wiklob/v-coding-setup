#!/usr/bin/env python3
"""Decision-matrix tests for the PreToolUse guard (bin/guard-secret-access.py).

Run: python3 bin/guard-access.test.py   (exit 0 = all pass, 1 = failure)

Each case feeds a tool event as JSON on stdin to the guard as a subprocess and asserts the
outcome by the documented contract:
  * deny  -> exit code 2
  * ask   -> exit code 0 AND stdout JSON hookSpecificOutput.permissionDecision == "ask"
  * allow -> exit code 0 AND no ask-JSON on stdout

Trigger strings (database/query URLs, `supabase db push`, etc.) live here as Python
literals fed via stdin — the shell line that runs this test stays clean, so the LIVE guard
never fires on the test invocation itself.
"""
import json, subprocess, sys, os

GUARD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guard-secret-access.py")
REF = "abcdefghijklmnopqrst"  # a stand-in project ref
MGMT = "https://api.supabase.com/v1/projects/" + REF


def decide(tool, tool_input):
    """Run the guard on one event; return ('deny'|'ask'|'allow', stdout, stderr)."""
    event = json.dumps({"tool_name": tool, "tool_input": tool_input})
    p = subprocess.run([sys.executable, GUARD], input=event,
                       capture_output=True, text=True)
    if p.returncode == 2:
        return "deny", p.stdout, p.stderr
    if p.returncode == 0:
        if p.stdout.strip():
            try:
                d = json.loads(p.stdout)
                if d.get("hookSpecificOutput", {}).get("permissionDecision") == "ask":
                    return "ask", p.stdout, p.stderr
            except json.JSONDecodeError:
                pass
        return "allow", p.stdout, p.stderr
    return "error(%d)" % p.returncode, p.stdout, p.stderr


def bash(cmd):
    return ("Bash", {"command": cmd})


CASES = [
    # --- AC1: deny raw-SQL database/query POSTs; keep read-only GETs allowed ---
    ("AC1 deny database/query POST",
     bash("curl -X POST %s/database/query -d '{\"query\":\"drop table x\"}'" % MGMT), "deny"),
    ("AC1 deny database/query even with implicit body",
     bash("curl %s/database/query --data-raw '{\"query\":\"select 1\"}'" % MGMT), "deny"),
    ("AC1 allow read-only GET analytics/logs",
     bash("curl -H \"Authorization: Bearer $TOKEN\" %s/analytics/endpoints/logs.all | jq ." % MGMT),
     "allow"),

    # --- AC2: ask on Management-API config writes ---
    ("AC2 ask on config PATCH",
     bash("curl -X PATCH %s/config/auth -d '{\"site_url\":\"x\"}'" % MGMT), "ask"),
    ("AC2 ask on config POST",
     bash("curl --request POST %s/config/auth --data '{}'" % MGMT), "ask"),
    ("AC2 ask on glued -XPOST (no space, bodyless)",
     bash("curl -XPOST %s/config/auth" % MGMT), "ask"),
    ("AC2 ask on glued -XDELETE (no space, bodyless)",
     bash("curl -XDELETE %s/config/auth" % MGMT), "ask"),
    ("AC2 ask on glued -XPATCH with body",
     bash("curl -XPATCH %s/config/auth -d '{}'" % MGMT), "ask"),
    ("AC2 allow read-only GET on a project endpoint",
     bash("curl -H \"Authorization: Bearer $TOKEN\" %s/config/auth | jq ." % MGMT), "allow"),

    # --- AC3 + AC4: supabase db push/reset gated in any position ---
    ("AC4 Hole-2 regression: printf-piped db push",
     bash("printf 'y\\n' | supabase db push --linked"), "ask"),
    ("AC3 bare-prefix db push",
     bash("supabase db push --linked"), "ask"),
    ("AC3 var-prefixed db reset",
     bash("FORCE=1 supabase db reset --linked"), "ask"),
    ("AC3 chained db push after &&",
     bash("git status && supabase db push"), "ask"),
    ("AC3 allow unrelated supabase subcommand",
     bash("supabase migration list --linked"), "allow"),

    # --- deny-first: a secret read alongside db push must DENY, not ask ---
    ("deny-first: secret read beats db-push ask",
     bash("cat .envrc | supabase db push"), "deny"),

    # --- no-regression on existing secret-exfil guard ---
    ("regression: cat .envrc still denied", bash("cat .envrc"), "deny"),
    ("regression: printenv still denied", bash("printenv"), "deny"),
    ("regression: echo credential var still denied", bash("echo $SUPABASE_ACCESS_TOKEN"), "deny"),
    ("regression: env|grep still denied", bash("env | grep TOKEN"), "deny"),
    ("regression: direnv exec still denied", bash("direnv exec /main echo hi"), "deny"),
    ("regression: Read of .env still denied", ("Read", {"file_path": "/x/.env"}), "deny"),

    # --- V-38: raw transcript-JSONL reads denied; redacting resolver verb allowed ---
    ("V-38 deny Read of transcript jsonl",
     ("Read", {"file_path": "/Users/testuser/.claude/projects/foo/abc.jsonl"}), "deny"),
    ("V-38 deny cat of transcript jsonl",
     bash("cat /Users/testuser/.claude/projects/foo/abc.jsonl"), "deny"),
    ("V-38 deny grep of transcript jsonl",
     bash("grep V-38 ~/.claude/projects/foo/abc.jsonl"), "deny"),
    ("V-38 deny python3 over transcript jsonl (interpreter class)",
     bash("python3 -c \"open('/Users/testuser/.claude/projects/foo/abc.jsonl').read()\""), "deny"),
    ("V-38 deny copy-to-readable-name of transcript jsonl",
     bash("cp ~/.claude/projects/foo/abc.jsonl /tmp/x"), "deny"),
    ("V-38 ALLOW redacting resolver verb over a transcript",
     bash("node ~/.claude/bin/transcript-resolver.mjs read /Users/testuser/.claude/projects/foo/abc.jsonl"),
     "allow"),
    ("V-38 scope: .jsonl OUTSIDE .claude/projects is unaffected",
     bash("cat /Users/testuser/projects/myapp/data/feed.jsonl"), "allow"),
    ("V-38 scope: Read of non-transcript .jsonl is unaffected",
     ("Read", {"file_path": "/some/repo/fixtures/sample.jsonl"}), "allow"),
    # safe-side: a transcript backup/copy holds the SAME cleartext secrets -> still DENY
    # (tightening to exact .jsonl would open a `cp x.jsonl x.jsonl.bak` exfil path).
    ("V-38 deny transcript backup (.jsonl.backup) inside projects",
     ("Read", {"file_path": "/Users/testuser/.claude/projects/foo/abc.jsonl.backup"}), "deny"),
    # not blindly greedy: a different extension that merely starts with .jsonl is NOT a transcript
    ("V-38 allow .jsonlx (different extension, not a transcript)",
     ("Read", {"file_path": "/Users/testuser/.claude/projects/foo/abc.jsonlx"}), "allow"),
    # carve-out is keyed on the INVOKED script (toks[i+1]) -- eval-mode smuggle is NOT exempt
    ("V-38 deny eval-mode smuggle past the resolver carve-out",
     bash("node -e \"require('fs').readFileSync('/Users/testuser/.claude/projects/foo/abc.jsonl')\" transcript-resolver.mjs"),
     "deny"),

    # --- benign commands stay frictionless ---
    ("benign: plain echo allowed", bash("echo hello"), "allow"),
    ("benign: git log allowed", bash("git log --oneline -5"), "allow"),
    ("benign: sourcing .envrc allowed", bash(". ./.envrc && curl -H \"Authorization: Bearer $TOKEN\" https://x | jq ."), "allow"),
]


def main():
    failures = []
    for name, (tool, ti), expected in CASES:
        got, out, err = decide(tool, ti)
        status = "ok" if got == expected else "FAIL"
        if got != expected:
            failures.append((name, expected, got, err.strip()))
        print("[%s] %-48s expected=%-5s got=%s" % (status, name, expected, got))
    print("\n%d/%d passed" % (len(CASES) - len(failures), len(CASES)))
    if failures:
        print("\nFAILURES:")
        for name, exp, got, err in failures:
            print("  - %s: expected %s, got %s%s" % (name, exp, got, ("  | " + err) if err else ""))
        sys.exit(1)


if __name__ == "__main__":
    main()
