# Agentic Workflow Playbook

Shared methodology for all coding agents in this repo (Claude Code, Codex, others).
`AGENTS.md` is the short rulebook; this file is the longer "how we work" reference.
Read it before starting any non-trivial task.

## 1. Core principles

1. **Context is the scarce resource.** Agent quality drops as the context window fills. Keep instruction files short, read only what you need, delegate noisy work (research, log analysis, review) to a separate context, and start fresh between unrelated tasks.
2. **Verify, don't assume.** Every task needs a runnable check: tests, build, type check, linter. Report real command output as evidence, never just "it should work".
3. **Explore, then plan, then code.** Do not start editing until you understand the relevant code and the plan is agreed.
4. **Small, reversible steps.** One focused change per task, committed separately, on its own branch.
5. **Humans own decisions.** Architecture, security-sensitive changes, and unclear requirements go to the human. Ask instead of guessing.
6. **Simplest thing that works.** Prefer a fixed workflow over autonomous multi-agent setups. Add agents only when a single agent clearly fails.

## 2. Standard task loop

For any non-trivial task:

1. **Explore** (read-only): find the relevant files, summarize how they work, list unknowns.
2. **Plan**: write the plan to `PLAN.md` (goal, files to touch, steps, how each step is verified, risks). Wait for human approval when the change is large or risky.
3. **Implement one step at a time**, staying inside the planned scope.
4. **Verify**: run the tests/lint/build after each step. Fix failures before moving on.
5. **Review**: inspect your own `git diff` (or hand it to a reviewer agent) against the spec.
6. **Commit** with a clear message. Then repeat or stop.

Skip the plan file only for trivial changes (typo, one-line fix, rename).

## 3. Orchestration patterns (use the simplest that fits)

| Pattern | Use when | In this repo |
|---|---|---|
| Prompt chaining | steps are known in advance | spec -> plan -> implement -> test -> review |
| Routing | different task types need different handling | bug -> debug flow, feature -> feature flow |
| Parallelization | jobs are independent | separate reviewers (security, performance, style) on one diff; separate agents on separate modules |
| Orchestrator-workers | steps can't be known upfront | lead agent splits a large feature, workers handle file-level changes |
| Evaluator-optimizer | quality needs iteration | implementer + reviewer loop, max 3 rounds, ends when tests and review pass |

Rules for multi-agent work:
- Parallelize only **independent** tasks that touch **different files**.
- Each parallel writer works in its own **git worktree/branch**.
- Tightly coupled design decisions stay with one agent or the human. Agents that cannot see each other's decisions make conflicting choices.
- Read-only helpers (research, review) are safe to run freely.
- Hand off work through files (`SPEC.md`, `PLAN.md`, `REVIEW.md`), not chat memory.

## 4. Roles

Use these as subagents/personas when helpful. One role per task.

- **Planner**: reads code, writes `PLAN.md`. Never edits source.
- **Implementer**: executes one plan step, runs verification. Stays in scope.
- **Reviewer**: reviews a diff against `SPEC.md`/`PLAN.md`, writes `REVIEW.md` with concrete problems (file, line, why). Never edits source. Fresh context, has not seen the implementation reasoning.
- **Test writer**: writes failing tests first (TDD). Implementer must not weaken them.

## 5. Verification gates

Work is **done** only when all of these are true:
- The project's test command passes (see `AGENTS.md` for exact commands).
- Lint and type check pass.
- No tests were deleted, skipped, or weakened to make them pass.
- The diff contains only changes related to the task.
- New behavior has tests.
- The reviewer (or human) has read the diff.

## 6. Safety rules

- Never commit secrets, tokens, or `.env` files. Never print them.
- No force-push, no history rewriting, no deleting branches without explicit human approval.
- No destructive commands (`rm -rf`, dropping databases, mass renames) without approval.
- Do not touch production systems or credentials.
- Do not edit generated files, lockfiles, or vendored code unless the task requires it.
- When blocked or uncertain, stop and ask. Do not invent requirements.

## 7. Context hygiene

- Keep `AGENTS.md` under roughly 150 lines. Move long detail into docs and link to it.
- Prefer file paths with line numbers when referring to code.
- Run noisy investigations (large logs, wide searches) in a subagent and return only a summary.
- Start a fresh session for each new task. Resume only when continuing the same task.
- Install only the MCP servers/plugins the project actually uses.

## 8. Parallel work with worktrees

```bash
git worktree add ../<repo>-<task> -b <task-branch>
# run one agent per worktree, then review and merge each branch as a PR
git worktree remove ../<repo>-<task>   # after merge
```

## 9. Headless pipelines (optional)

Chain the tools from scripts or CI. Check each CLI's `--help` for current flags.

```bash
claude -p "Read SPEC.md and write a step-by-step plan to PLAN.md"
codex exec "Implement step 1 of PLAN.md. Run the tests."
claude -p "Review the git diff against SPEC.md. Write problems to REVIEW.md"
```

Keep unattended runs sandboxed or read-only, with a human approving merges.

## 10. Improving this setup

When an agent repeats a mistake, add one short rule to `AGENTS.md`. When a rule is never useful, delete it. Review this playbook whenever the workflow changes.
