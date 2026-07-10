# Decisions — the log

Append-only, newest-first. Each entry records a decision made and *why*. ADR-style: entries are **immutable** — a later decision that reverses an earlier one is a new entry on top, not an edit (the old one was true once; the history is the value). No staleness by construction — an entry describes a moment, never "now".

Schema per entry: `### YYYY-MM-DD — <decision>` · **Why** · (optional) **Supersedes**.

---

<!-- no entries yet — newest entry goes directly under this line -->

---

## Deferred (owed follow-up work — filed)

> Owed-principle **waivers** are also recorded here, in the format defined by [`owed.md` §Waiver](./owed.md) (`### YYYY-MM-DD — WAIVER: …`) — distinct from filed-as-a-ticket deferrals.

<!-- One line per filed deferral: **[<TICKET-ID>]** <what is owed and where it was designed>. -->
