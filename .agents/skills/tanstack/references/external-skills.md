<!-- Vendored copy. Source of truth: the repo-root references folder, file external-skills.md. Edit it there, then run scripts/sync-references.sh. -->

# External skills manifest

Every third-party skill this repo points at, pinned to a commit. A skill that is not in this table must not be installed by any skill here. Rules for installing are in `references/supply-chain.md`.

## Pinned sources

Pins are the upstream `HEAD` observed on 2026-10-10. **Review status: pinned, contents not yet reviewed by the repo owner.** Review a skill (read its `SKILL.md` and any bundled files) before its first use, then change its status here.

| Source | Skills used | Used by | Pinned commit | Reviewed |
| --- | --- | --- | --- | --- |
| `mattpocock/skills` | `grill-me`, `research`, `prototype`, `wayfinder`, `pr`, `retro` | `product-flow` | `49dd158d1076134a641b33efb035946536778336` | no |
| `addyosmani/agent-skills` | `spec-driven-development`, `constraint-driven-development`, `planning-and-task-breakdown`, `incremental-implementation`, `test-driven-development`, `debugging-and-error-recovery`, `code-review-and-quality`, `security-and-hardening`, `shipping-and-launch` | `product-flow` | `1be8e34187e34647bb83adc3a1323b26ae6f6abe` | no |
| `CJHarmath/claude-agents-skills` | `react-zustand-patterns`, `react-performance`, `react-testing`, `react-async-patterns`, `react-state-flows`, `postgres-patterns`, `postgres-performance` | `zustand`, `react`; the two `postgres-*` skills are project-level (grand-line backend), not used by a skill here | `185c964f7d5dcdb89829ee1cad2d792dd82efac1` | no |
| `millionco/react-doctor` | `react-doctor` | project-level (grand-line pre-beta code check), not used by a skill here | `5b301c9f5103e257cb6d88985b846bcc725ea7b3` | yes, 2026-10-10, with conditions (see notes) |
| `microsoft/skills` | `zustand-store-ts` | `zustand` | `d5741a1e9325adead3a28d1d203bb69283907e06` | no |
| `DeckardGer/tanstack-agent-skills` | `tanstack-query` | `tanstack` | `b2fc14c974b2ca09b38de09c28237f240175205b` | no |
| `TanStack/ai` | `tanstack-ai`, `tanstack-ai-migration` | `tanstack` (only for `@tanstack/ai` projects) | `c97ae8c270836decf1c8c0ec15f7422a227db88d` | no |

Not skills but also pinned: `@tanstack/intent@0.5.5` (see the `tanstack` skill).

## Review notes

- **`postgres-patterns`, `postgres-performance`** (`CJHarmath/claude-agents-skills` at the pin): read 2026-10-10. Plain SQL guidance, no commands to fetch or run. `postgres-patterns` is written for Alembic (Python) migrations, so adapt the migration advice if the backend uses another tool. The other skills from this source stay unreviewed.
- **`react-doctor`** (`millionco/react-doctor` at the pin): read 2026-10-10. Two behaviors conflict with `supply-chain.md`:
  1. Its commands use a floating `latest` tag on `react-doctor`. Pin the version instead (check `npm view react-doctor version`, then `npx react-doctor@<version>`) and tell the agent to use it.
  2. Its `/doctor` workflow fetches a playbook from the react.doctor site at run time and tells the agent to follow every step. That text can change after review. Do not run `/doctor` unless you have read the current playbook and accept it; the plain scan commands do not need it.
  Its bundled rule-explainer file was not reviewed beyond its size.

## Install procedure (pinned, project-scoped)

Run only after the user has confirmed the skill list. Replace `<owner>/<repo>`, `<sha>` and `<skill>` from the table.

```bash
tmp="$(mktemp -d)"
git clone --quiet https://github.com/<owner>/<repo> "$tmp/src"
git -C "$tmp/src" checkout --quiet <sha>
# locate the skill folder (usually skills/<skill>/) and READ it before copying
find "$tmp/src" -type d -name '<skill>' -not -path '*/.git/*'
cat "$tmp/src/skills/<skill>/SKILL.md"
mkdir -p ./.agents/skills ./.claude/skills
cp -R "$tmp/src/skills/<skill>" ./.agents/skills/
ln -s ../../.agents/skills/<skill> ./.claude/skills/<skill>
```

`.agents/skills/` is read by Codex and OpenCode; Claude Code reads `.claude/skills/`, so the link serves it from the same copy.

Install at the repo root so every package in a monorepo shares it. Do not use `npx skills add`, `@latest`, or `-g` for these sources: they follow the default branch, so the content can change after the pin.

If a skill reports a missing shared checklist, copy that pack's `references/` folder from the same pinned checkout after reading it. Do not install the whole pack.

## Updating a pin

1. Read the diff between the old and new commit for each skill in use.
2. Update the commit here and set `Reviewed` accordingly.
3. Commit with `chore(deps): bump <source> pin`.
