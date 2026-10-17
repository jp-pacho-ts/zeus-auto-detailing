# Overhaul Prompt

Paste everything below the line into Claude Code (start in plan mode) or Codex.
Do this on a new git branch, for example `git checkout -b chore/agentic-overhaul`.

---

I want to overhaul how coding agents work in this repository so it follows the methodology in `AGENTIC_WORKFLOW.md`. Read that file first.

This project already has agent instruction files (`AGENTS.md`, `CLAUDE.md`, and possibly others such as `.claude/`, `.codex/`, `.cursor/`, or custom agent prompts). They were not set up properly. Do NOT delete or rewrite anything yet.

## Phase 1: Audit (read-only)

1. List every agent-related file and folder: `AGENTS.md`, `CLAUDE.md`, `.claude/` (agents, commands, skills, settings), `.codex/`, `.mcp.json`, hooks, scripts, CI jobs that call agents.
2. Read them and report:
   - Duplicated or contradictory instructions between files
   - Outdated or wrong commands (verify build/test/lint commands by actually running them)
   - Instructions that are too long, vague, or never actionable
   - Missing pieces: verification commands, safety rules, definition of done
   - MCP servers, hooks, or subagents that look unused or risky
3. Inspect the project itself: language, framework, folder layout, how tests/lint/build run, branching and commit conventions.

## Phase 2: Proposal (no edits yet)

Write `OVERHAUL_PLAN.md` containing:
- Findings from the audit
- Target structure, following these decisions unless you find a strong reason not to:
  - `AGENTS.md` is the single source of truth: short (under about 150 lines), with project overview, exact build/test/lint commands, code conventions, safety rules, and a pointer to `AGENTIC_WORKFLOW.md`.
  - `CLAUDE.md` contains only Claude-specific notes and imports or points to `AGENTS.md` so the two files cannot drift apart. Do not duplicate content between them.
  - Long detail lives in `docs/` and is linked, not pasted into instruction files.
  - Optional: reviewer and planner subagents in `.claude/agents/`, plus a verification hook, only if they fit this project.
- A file-by-file list of what will be kept, merged, rewritten, or removed, with a reason for each
- Any content from the old files you are unsure about, listed as questions for me instead of silently dropped

Then STOP and wait for my approval.

## Phase 3: Implementation (after approval only)

- Work in small steps. Commit after each step with a clear message.
- Preserve useful project-specific knowledge from the old files. Merge, do not discard.
- Run the verification commands after changes and show the output.
- Do not change application source code. This task only touches agent configuration and docs.

## Phase 4: Review

- Show me the final `git diff --stat` and a summary of what changed and why.
- List anything left unresolved.
- Suggest at most three follow-up improvements, ordered by value.

## Rules for this task

- Ask me when something is ambiguous. Do not guess.
- Never commit secrets. Never force-push.
- Keep the new instruction files short. Shorter and accurate beats long and thorough.
