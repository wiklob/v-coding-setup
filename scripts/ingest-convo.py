#!/usr/bin/env python3
"""Render a Claude Code session transcript (.jsonl) as a clean, context-ready markdown digest.

Two modes:
  --list                      table of recent transcripts (index, when, size, lines, project, preview)
  <target>                    render one transcript to stdout (or --out FILE)

<target> resolves as, in order:
  - an existing .jsonl path
  - a session id (uuid prefix) searched across ~/.claude/projects/*/
  - a substring matched against transcripts' first user message (most-recent wins; ambiguous -> exit 2)

Profiles (presets over two knobs: thinking on/off, tools full|line|off):
  full      (default)  text + tools summarized,        thinking off   -- security investigations
  thinking             text + thinking,                tools one-line -- self-improvement / reasoning
  dialogue             text only,                      tools off      -- smallest

Override either knob explicitly: --thinking/--no-thinking, --tools full|line|off.

This script is the single committed parser so sessions never hand-roll a throwaway one.
"""
import argparse, glob, json, os, re, sys, time

PROJECTS = os.path.expanduser("~/.claude/projects")
SKIP_TYPES = {
    "file-history-snapshot", "mode", "agent-setting", "permission-mode",
    "custom-title", "agent-name", "last-prompt", "system",
}
DATA_URI = re.compile(r"data:[^;]+;base64,[A-Za-z0-9+/=]+")
LONG_B64 = re.compile(r"\b[A-Za-z0-9+/]{200,}={0,2}\b")
REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.DOTALL)


def scrub(s):
    if not isinstance(s, str):
        s = str(s)
    s = DATA_URI.sub("[data-uri]", s)
    s = LONG_B64.sub("[base64]", s)
    return s


def first_user_msg(path):
    """First real typed user message (skip meta/tool-result/reminder-only lines)."""
    try:
        with open(path) as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if d.get("type") != "user" or d.get("isMeta") or d.get("isSidechain"):
                    continue
                c = d.get("message", {}).get("content")
                txt = None
                if isinstance(c, str):
                    txt = c
                elif isinstance(c, list):
                    for b in c:
                        if isinstance(b, dict) and b.get("type") == "text":
                            txt = b.get("text"); break
                if not txt:
                    continue
                txt = REMINDER.sub("", txt).strip()
                txt = re.sub(r"<command-[^>]+>.*?</command-[^>]+>", "", txt, flags=re.DOTALL).strip()
                if txt:
                    return " ".join(txt.split())
    except Exception:
        pass
    return ""


def list_transcripts(args):
    pat = os.path.join(PROJECTS, args.project if args.project else "*", "*.jsonl")
    files = glob.glob(pat)
    rows = []
    for f in files:
        try:
            st = os.stat(f)
        except OSError:
            continue
        rows.append((st.st_mtime, st.st_size, f))
    rows.sort(reverse=True)
    rows = rows[: args.n]
    print(f"{'#':>3}  {'when':<16}  {'size':>7}  {'project':<28}  preview")
    print("-" * 100)
    for i, (mt, sz, f) in enumerate(rows):
        when = time.strftime("%Y-%m-%d %H:%M", time.localtime(mt))
        proj = os.path.basename(os.path.dirname(f))
        proj = proj[-28:]
        kb = f"{sz/1024:.0f}K" if sz < 1024 * 1024 else f"{sz/1048576:.1f}M"
        sid = os.path.basename(f)[:8]
        prev = first_user_msg(f)[:80]
        print(f"{i:>3}  {when:<16}  {kb:>7}  {proj:<28}  [{sid}] {prev}")


def resolve(target):
    if os.path.isfile(target):
        return target
    # uuid / session-id prefix across all projects
    hits = glob.glob(os.path.join(PROJECTS, "*", f"{target}*.jsonl"))
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        sys.stderr.write("Ambiguous session id, candidates:\n" + "\n".join(hits) + "\n")
        sys.exit(2)
    # substring against first user message, most-recent wins
    cand = []
    for f in glob.glob(os.path.join(PROJECTS, "*", "*.jsonl")):
        fum = first_user_msg(f)
        if target.lower() in fum.lower():
            cand.append((os.stat(f).st_mtime, f, fum))
    cand.sort(reverse=True)
    if not cand:
        sys.stderr.write(f"No transcript path/id/preview matched: {target!r}\n")
        sys.exit(2)
    if len(cand) > 1:
        sys.stderr.write("Multiple preview matches (using most recent; pass a session id to disambiguate):\n")
        for mt, f, fum in cand[:8]:
            sys.stderr.write(f"  [{os.path.basename(f)[:8]}] {fum[:70]}\n")
    return cand[0][1]


def render_tool_input(name, inp, tools_mode):
    if tools_mode == "line":
        return f"  ⎿ {name}"
    if not isinstance(inp, dict):
        return f"  ⎿ {name}: {scrub(json.dumps(inp))[:200]}"
    # compact one-line-ish summary of the salient args
    keys = ("command", "query", "file_path", "path", "pattern", "prompt", "url", "description", "old_string", "content")
    parts = []
    for k in keys:
        if k in inp and inp[k]:
            v = scrub(str(inp[k]))
            v = " ".join(v.split())
            parts.append(f"{k}={v[:300]}")
    if not parts:
        parts.append(scrub(json.dumps(inp))[:300])
    return f"  ⎿ {name}: " + " | ".join(parts)


def render_tool_result(content, max_lines, max_chars):
    if isinstance(content, list):
        chunks = []
        for b in content:
            if not isinstance(b, dict):
                chunks.append(str(b)); continue
            t = b.get("type")
            if t == "text":
                chunks.append(b.get("text", ""))
            elif t == "image":
                chunks.append("[image]")
            elif t == "tool_reference":
                chunks.append(f"[ref:{b.get('tool_name','?')}]")
            else:
                chunks.append(f"[{t}]")
        content = "\n".join(chunks)
    content = scrub(content)
    lines = content.splitlines()
    truncated = False
    if len(lines) > max_lines:
        lines = lines[:max_lines]; truncated = True
    out = "\n".join(lines)
    if len(out) > max_chars:
        out = out[:max_chars]; truncated = True
    out = "\n".join("     " + l for l in out.splitlines())
    if truncated:
        out += "\n     … [truncated]"
    return out


def render(path, args):
    thinking = args.thinking
    tools = args.tools  # full | line | off
    tool_names = {}
    out = []
    header = os.path.basename(path)
    proj = os.path.basename(os.path.dirname(path))
    out.append(f"# Transcript: {header}")
    out.append(f"_project: {proj}_\n")

    with open(path) as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except Exception:
                continue
            typ = d.get("type")
            if typ in SKIP_TYPES:
                continue
            if d.get("isMeta"):
                continue
            side = d.get("isSidechain")
            if side and args.no_sidechains:
                continue
            tag = "↳sub " if side else ""
            msg = d.get("message")
            if not isinstance(msg, dict):
                continue
            content = msg.get("content")
            role = msg.get("role", typ)

            if isinstance(content, str):
                txt = REMINDER.sub("", content).strip()
                txt = scrub(txt)
                if txt:
                    out.append(f"## {tag}{role}\n{txt}\n")
                continue

            if not isinstance(content, list):
                continue

            for b in content:
                if not isinstance(b, dict):
                    continue
                bt = b.get("type")
                if bt == "text":
                    txt = REMINDER.sub("", b.get("text", "")).strip()
                    txt = scrub(txt)
                    if txt:
                        out.append(f"## {tag}{role}\n{txt}\n")
                elif bt == "thinking":
                    if thinking:
                        th = scrub(b.get("thinking", "")).strip()
                        if th:
                            out.append(f"### {tag}{role} (thinking)\n{th}\n")
                elif bt == "tool_use":
                    name = b.get("name", "?")
                    tool_names[b.get("id")] = name
                    if tools != "off":
                        out.append(render_tool_input(name, b.get("input"), tools))
                elif bt == "tool_result":
                    if tools == "off":
                        continue
                    name = tool_names.get(b.get("tool_use_id"), "result")
                    body = render_tool_result(b.get("content", ""), args.max_tool_lines, args.max_tool_chars)
                    if tools == "line":
                        # keep only a count-ish hint
                        nlines = body.count("\n") + 1
                        out.append(f"     [{name} → {nlines} lines]")
                    elif body.strip():
                        out.append(body)
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", nargs="?", help="path | session-id | preview substring")
    ap.add_argument("--list", action="store_true", help="list recent transcripts and exit")
    ap.add_argument("--project", help="restrict --list to one project dir (basename)")
    ap.add_argument("-n", type=int, default=20, help="how many to list (default 20)")
    ap.add_argument("--profile", choices=["full", "thinking", "dialogue"], default="full")
    ap.add_argument("--thinking", dest="thinking", action="store_true", default=None)
    ap.add_argument("--no-thinking", dest="thinking", action="store_false")
    ap.add_argument("--tools", choices=["full", "line", "off"], default=None)
    ap.add_argument("--no-sidechains", action="store_true", help="drop subagent sidechains")
    ap.add_argument("--max-tool-lines", type=int, default=40)
    ap.add_argument("--max-tool-chars", type=int, default=4000)
    ap.add_argument("--out", help="write to FILE instead of stdout")
    args = ap.parse_args()

    if args.list:
        list_transcripts(args); return

    if not args.target:
        ap.error("need a target (path | session-id | substring), or --list")

    # apply profile presets, then honor explicit overrides
    presets = {
        "full":     dict(thinking=False, tools="full"),
        "thinking": dict(thinking=True,  tools="line"),
        "dialogue": dict(thinking=False, tools="off"),
    }[args.profile]
    if args.thinking is None:
        args.thinking = presets["thinking"]
    if args.tools is None:
        args.tools = presets["tools"]

    path = resolve(args.target)
    text = render(path, args)
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(text)
        sys.stderr.write(f"wrote {len(text)} chars ({text.count(chr(10))} lines) -> {args.out}\n")
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
