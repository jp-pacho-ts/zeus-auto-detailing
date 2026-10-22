@AGENTS.md

# Claude Code notes

Shared rules are in AGENTS.md. Do not duplicate them here.
Confirm whether this session is ZEUS-PM or ZEUS-CLAUDE from the LE's dispatch.

- PM startup: .team/START-HERE.md. Engineering role: .team/roles/fullstack.md.
- Use installed skills when relevant; project scope and rules override skill defaults.
- The Stop hook (.claude/settings.json, .claude/hooks/verify.mjs) runs typecheck/lint when TS/JS or package files have uncommitted changes. Fix reported failures before finishing.
- Hook tests: `node --test .claude/hooks/verify.test.mjs`.
- Machine-only settings belong in ignored .claude/settings.local.json.
