# Zeus Auto Detailing: shared rules

Read this first. It applies to every provider and session.
Current LE (human Lead Engineer) instructions override these files. Task scope controls edits.

## Start here

1. Read the current entry in [.team/BOARD.md](.team/BOARD.md).
2. Read your assigned task and its current summary.
3. Read only the relevant contracts and dependency handoffs.
4. Confirm the branch, worktree and working-tree changes before editing.

For the process, consult [.team/WORKFLOW.md](.team/WORKFLOW.md) as needed.
For skills, read [.agents/AGENTS.md](.agents/AGENTS.md).
For a new PM session, use [.team/START-HERE.md](.team/START-HERE.md).

## Roles and authority

- **ZEUS-PM:** plans, assigns tasks, maintains BOARD and dispatch prompts. The provider may be Claude or GPT/Codex; switching it requires the LE's instruction. It may implement only an explicitly assigned task in its own worktree.
- **ZEUS-CLAUDE / ZEUS-CODEX:** full-stack engineers. Capability never expands task scope.
- **ZEUS-CODEX:** designated integrator for local dev.
- The LE starts sessions manually. Never launch agents, subagents, background AI workers or automated dispatch.
- At most two implementation writers, on independent scopes. Schema, migrations, shared contracts/validation, dependencies/lockfiles and config have one writer at a time.
- One owner, branch and writing worktree per implementation task. Transfers must preserve existing work and record custody.
- Review and integrated QA must be independent of the provider that authored the affected changes. GPT PM and Codex are the same provider for this rule.

A task assigned by the LE or PM in TODO/DOING authorizes implementation. A direct LE request also authorizes its stated scope; routine documentation work does not require inventing a P1 feature task.
Only PM or the LE edits BOARD and task assignment metadata. Engineers record plans and progress in handoffs.

## Safety and approval

Explicit LE approval is required for every push, merge to main, production deployment, live Railway operation and destructive action (including reset, revert, history rewrite, branch/worktree deletion and dropping databases).
No automatic reset or revert. Never print, copy or commit .env, credentials or customer PII. Never copy .env into a worktree.
Use synthetic data on loopback databases only; never run the historical demo seed.
Preserve historical handoffs and archives.

**Design policy (LE 2026-10-21):** the design lock is removed. In-scope visual changes need no separate approval. Reuse components and tokens, keep pages consistent and attach before/after screenshots. This does not authorize unrelated redesigns.

## Workspace and Git

- The canonical root is the integration checkout; implement application changes in the assigned task worktree.
- Create task worktrees from local dev: `git worktree add ../zeus-p1-NN -b feat/p1-NN-<slug> dev`. Reuse assigned worktrees. If dev is missing, report it; do not recreate it.
- .team/, .agents/, prompts/ and config/ai-team.json are local-only. Read them at the canonical root; worktrees do not inherit them.
- Canonical root: `C:/Users/User/Documents/Code Projects/zeus-auto-detailing/`.
- Read current shared instructions at that root even when a task branch contains an older tracked copy. Reconcile outdated instruction-file commits during integration; do not overwrite current policy with a stale branch version.
- Directly authorized workflow-document maintenance may update these canonical instruction files; do not edit application code as part of it.
- Commit scoped implementation on its task branch after self-review. Use `type(scope): summary`, explain why in the body and add the provider's attribution trailer.
- No PRs. No push without approval. Only ZEUS-CODEX integrates reviewed, verified SHAs into dev with `git merge --no-ff <branch>`.

## Stack and conventions

Next.js 16 App Router, React 19, strict TypeScript, Prisma 6/PostgreSQL, Tailwind 3, Zod 4. npm only; Node >=22.
Validate server input with Zod; authorize inside services and fail closed.
Server modules import server-only; database access stays in src/server.
Booking writes preserve transactions and advisory locks.
Money is integer centavos; shop timezone is Asia/Manila.
Use src/config/brand.ts for brand/contact/currency and the @/ import alias.
Customers never see bays, capacity counts, workers or staff-entered reasons.
ADR-005 governs booking/dashboard behavior; older ADRs and ARCHITECTURE apply where compatible.

## Verification

Check package.json before naming scripts. In PowerShell use npm.cmd/npx.cmd.
Never run build or dev in the canonical root: Next loads its .env.
Use a task worktree or git-archive export without .env; set DATABASE_URL to a loopback test DB.

| Command | Purpose |
|---|---|
| npm.cmd ci | Install; coordinate package/lockfile writers |
| npx.cmd prisma generate | Fresh install or schema change |
| npm.cmd run typecheck | Next typegen and TypeScript |
| npm.cmd run lint | ESLint, zero warnings |
| npm.cmd test | node:test; DB tests may skip without DB |
| npm.cmd run build | Production build in isolated checkout |

For DB tests, create a fresh zeus_t007_* loopback database. Set BOTH DATABASE_URL and T007_TEST_DATABASE_URL before migrate deploy (no seed), then npm test. See src/server/__tests__/README.md.
For catalog verification, follow prisma/catalog/README.md: PG_BIN, CATALOG_TEST_DATABASE_URL and CATALOG_SOURCE_PATH must be set to synthetic/local resources and the canonical catalog.
Do not hand-edit generated files or change lockfiles unless task scope requires it.
Write failing tests for new behavior and regression tests for bugs. Record exact commands, exit codes and skipped checks. Never claim unrun checks passed.

## Completion

Statuses: TODO, DOING, REVIEW, BLOCKED, DONE. PASS/FAIL are verdicts.
An implementation task is DONE only after final-SHA checks (typecheck, lint, tests, build and applicable DB suites), scoped self-review, opposite-provider review PASS, dev integration and verification, independent integrated QA PASS, and PM's completion update.
No tests may be deleted, skipped or weakened to pass. A merge or supplemental self-QA alone is not completion.
Evidence filenames and transfer/release steps are in WORKFLOW.md.
