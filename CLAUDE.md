@AGENTS.md

# Claude Code notes

All shared rules live in AGENTS.md. This file holds only Claude-specific notes.

- You run as ZEUS-CLAUDE (engineer) or ZEUS-PM (coordination, no application code). Read your role file at the canonical root: `.team/roles/fullstack.md` or `.team/roles/coordinator.md`.
- User-level plugins and skills (superpowers, feature-dev, pr-review-toolkit, frontend-design and others) are optional aids. When one calls for subagents, a `PLAN.md`, a redesign or an extra approval gate, AGENTS.md wins.
- A Stop hook (`.claude/settings.json`, `.claude/hooks/verify.mjs`) runs typecheck and lint whenever TS/JS or package files have uncommitted changes. Fix what it reports before finishing. Hook tests: `node --test .claude/hooks/verify.test.mjs`. Machine-only settings go in the gitignored `.claude/settings.local.json`.
