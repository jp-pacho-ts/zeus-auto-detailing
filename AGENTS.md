# Zeus Auto Detailing: agent rulebook

The single source of truth for Codex and Claude Code. `CLAUDE.md` adds only Claude-specific notes. The general method is [AGENTIC_WORKFLOW.md](AGENTIC_WORKFLOW.md); where it differs, this file wins. Current LE instructions override both, and the assigned task's scope and contracts govern behavior.

## Project

Online booking and admin dashboard for Zeus Auto Detailing (Tacloban City). Next.js 16 App Router, React 19, TypeScript (strict), Prisma 6 + PostgreSQL, Tailwind 3, Zod 4. **npm only, Node >=22.** Hosting target is Railway.

| Path | Contents |
| --- | --- |
| `src/app` | Pages, `api/` route handlers, `admin/` staff portal |
| `src/components` | `ui/` primitives, `layout/`, `booking/`, `home/`, `admin/` |
| `src/server` | Server-only services, `actions/`, `__tests__/` (test loader and README) |
| `src/config` | `brand.ts` (names, contact, currency, timezone), `catalog.ts` |
| `src/lib` | `validation.ts` (Zod), utils, ESLint config |
| `prisma` | Schema, `migrations/`, `catalog/` (catalog tooling, tests, verifier) |
| `docs` | Client proposal, `ui-reference/`. `docs/client/` is local-only |

Current scope is Phase 1 (`.team/PHASES.md`). Phase 2 has not started.

## Commands

The block below was verified 2026-10-17. The DB and catalog suites were not re-run then (they need PostgreSQL); their steps come from the linked READMEs. Record exact commands and exit codes in handoffs, and never claim an unrun check passed.

```powershell
npm ci                 # install; package.json/lockfile have one writer at a time
npx prisma generate    # after a fresh install or a schema change
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint, --max-warnings 0
npm test               # node:test on src/**/*.test.ts; the 6 DB tests skip without a DB
npm run build          # next build: task worktree or git-archive export only
```

- **Never run `npm run build` or `npm run dev` in the canonical root**: Next loads its `.env` there. Task worktrees have no `.env`; set `DATABASE_URL` to a loopback test database in the process environment.
- **DB integration tests:** create a new empty loopback database named `zeus_t007_*` and apply the schema with `npx prisma migrate deploy` (no seed). Set both `T007_TEST_DATABASE_URL` and `DATABASE_URL` to it, then run `npm test`. See `src/server/__tests__/README.md`.
- **Catalog verifier:** set `PG_BIN` (PostgreSQL 18 binaries), `CATALOG_TEST_DATABASE_URL` (loopback admin URL on a fresh `initdb` cluster) and `CATALOG_SOURCE_PATH` (canonical `docs/client/service-catalog.md`), then run `node prisma/catalog/verify.mjs`. See `prisma/catalog/README.md`.
- There is no CI. Check `package.json` before naming a script; never invent one.

## Who does what

The LE manually runs three sessions on two providers. **Agents never launch other agents, subagents, background AI workers or automated pipelines.**

| Terminal | Provider | Role |
| --- | --- | --- |
| ZEUS-PM | Claude Code | Project manager: turns LE goals into tasks, assigns Owner/Reviewer, owns BOARD.md. No application code |
| ZEUS-CLAUDE | Claude Code | Full-stack engineer: UI, server/APIs, data, security, QA, CI/CD, Git |
| ZEUS-CODEX | Codex | Full-stack engineer with the same scope. **Designated `dev` integrator** |

Renamed 2026-10-17. Older handoffs, tasks and BOARD.md entries may still use PM-PROJ-ZEUS, CLAUDE-PROJ-ZEUS and CODEX-PROJ-ZEUS; they mean the same sessions.

- An LE-assigned `.team/tasks/P1-NN.md` in TODO or DOING authorizes implementation. Without one, report availability and wait. PM writes tasks; engineers do not.
- Read `.team/BOARD.md` before starting: your task, its dependencies and any LE notice. Only PM or the LE edits BOARD.md.
- Each task has one Owner, one branch and one writing worktree, plus a Reviewer from the **opposite provider**. Switching role labels never makes self-review independent. Another provider changes a task only after a documented transfer (WORKFLOW.md).
- At most two implementation writers at once, on independent scopes with stable contracts. Schema, migrations, shared contracts/validation, package/lockfiles and config have **one writer at a time**, sequenced by PM.
- The owner covers the task end to end (UI, server, data, security tests, QA, CI/CD config, Git). Full-stack capability never widens the task's file scope.

## Task loop

Follow AGENTIC_WORKFLOW §2 (explore, plan, implement, verify, review, commit) with these project overrides:

- Plan inside the P1 task or its handoff, not in `PLAN.md`. The root `PLAN.md` is a superseded history file.
- Write failing tests first for new behavior; add a regression test for every bug.
- Record routine in-scope ambiguity as a Ruling (decision, reason, cost if wrong) and continue. Escalate conflicting business or security contracts, or out-of-scope work, to PM/LE.
- Self-review the diff, commit on the task branch, and write `.team/handoffs/P1-NN.md` with the final SHA, commands and exit codes. Then stop.
- The Reviewer reviews the exact SHA read-only and writes `.team/handoffs/P1-NN-review-<codex|claude>-<shortsha>.md`: PASS/FAIL, and findings with severity, file:line, reproduction and the regression check needed. Valid findings return the same task to DOING. Every fix needs a delta review of the final SHA.
- No PRs, pushes, `SPEC.md` or `REVIEW.md`. All evidence goes in handoffs (naming rules in WORKFLOW.md).

## Git

- Create task worktrees from local `dev`: `git worktree add ../zeus-p1-NN -b feat/p1-NN-<slug> dev`. Reuse assigned worktrees. If `dev` is missing, report it; do not recreate it.
- Do not implement in the canonical root: it is the integration checkout. Preserve other people's uncommitted work.
- Commit messages: `type(scope): summary`, with type `feat|fix|chore|docs` and scope a task id (`p1-09`) or area (`db`, `repo`). The body explains why. End with your provider's attribution trailer.
- Only ZEUS-CODEX merges reviewed, verified SHAs into `dev` (`git merge --no-ff <branch>`), then re-runs the checks on the integrated SHA. `main` needs LE approval.
- `.team/`, `.agents/`, `prompts/` and `config/ai-team.json` are gitignored and absent from worktrees. Read them at the canonical root: `C:/Users/User/Documents/Code Projects/zeus-auto-detailing/`.

## Code conventions

- Validate all server input with Zod (`src/lib/validation.ts`), authorize inside services and fail closed.
- Server modules import `server-only`, and database access stays in `src/server`. Booking writes keep their transactions and advisory locks (`src/server/bookings.ts`).
- Money is integer centavos. The shop timezone is Asia/Manila. Brand text, contact details and currency come from `src/config/brand.ts`.
- Import with the `@/` alias. Reuse `src/components/ui` and the existing Tailwind tokens.
- Customers never see bay counts or staff-entered block reasons.
- **The design is locked (LE 2026-10-17):** preserve colors, fonts, spacing, layout, header, footer and hero. Any visual change needs explicit LE approval with before/after screenshots. Skills and plugins never authorize a redesign.

## Safety

- **Explicit LE approval is required for:** every push, every merge to `main`, production deployment, any live Railway operation, any visual or design change, and any destructive action (history rewrite, reset, revert, branch or worktree deletion, dropping databases). Never revert or reset automatically.
- Never print, copy or commit `.env`, credentials or customer PII. Never copy `.env` into a worktree.
- Use synthetic data on loopback databases only. Never run the historical demo seed.
- Build security tests into every task. P1-12 is the dedicated integrated security review; there is no per-task security gate.
- Do not edit generated files (`next-env.d.ts`, `.next/`, the Prisma client) or lockfiles unless the task requires it.
- Preserve historical evidence (handoffs, `.team/archive/`). Old T-NNN tasks, archived handoffs and `PLAN.md` are technical evidence, never current routing or authorization.

## Definition of done

Statuses are TODO, DOING, REVIEW, BLOCKED and DONE; PASS/FAIL is a verdict. A task is **DONE** only when all of these hold:

1. On the final SHA, typecheck, lint, `npm test` and build exit 0, plus the applicable DB suites, with real output recorded.
2. No test was deleted, skipped or weakened to pass, and new behavior and bugs have tests.
3. The diff contains only task-scoped changes, and the design is unchanged unless the LE approved a change.
4. The opposite provider reviewed the final SHA: PASS.
5. Codex merged it into `dev` and re-verified, and the opposite provider's integrated QA is PASS.
6. PM recorded completion. A `dev` merge alone is not DONE.

## More detail (local-only, at the canonical root)

- `.team/WORKFLOW.md`: full process, transfers, integration, QA and handoff naming
- `.team/ROUTING.md`, `.team/roles/fullstack.md`, `.team/roles/coordinator.md`
- `.team/PHASES.md`, `.team/tasks/`, `.team/handoffs/`, `.team/templates/HANDOFF.md`
- `.team/decisions/ADR-001` to `ADR-004` (contracts) and `.team/ARCHITECTURE.md` (3,000+ lines: search it, don't read it whole)
- `.agents/AGENTS.md`: how the installed local skills apply
- `prompts/AGENT-PROMPTS.md`: dispatch prompts

When an agent repeats a mistake, add one short rule here. When a rule is never useful, delete it.
