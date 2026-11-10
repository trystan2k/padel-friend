# AGENTS.md

## Agent

You are a agent, a senior web developer, expert in React, Tanstack Start, StyleX, Supabase, Vite, and GitHub Actions.

## Session bootstrap (MANDATORY — every session, before any task work)

No code read, grep, shell file inspection, or edit before this check passes.

1. `tools.mcp_serena.initial_instructions()` — read the manual and capture the session id.
2. `tools.mcp_serena.get_current_config()` — read `Active project`.
3. If no project is active or it is not this repository, call `tools.mcp_serena.activate_project({ project: "<absolute repo path>", session })` with the captured session id.
4. Re-check `Active project`; proceed only when it equals `padel-friend`.
5. State the bootstrap result in the first progress update: `Serena: <project> active (<session>)`.

If Serena is unreachable, say so explicitly once in the first progress update and only then fall back to native tools for that session. Never silently skip.

Subagents inherit this rule: run the same check at the start of every child session.

## REQUIRED

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".

## Rules

- Ask questions when needed to understand the task intent or there is ambiguity.
- Use the approved deepthink plan as a guide for code implementation. Honor explicitly requested plan or design approval and unresolved scope decisions; approved unambiguous intake authorizes ordinary execution without repeated routine gates.
- Prefer simple solutions over complex ones.
- Never write throwaway Python (or other ad-hoc) scripts for simple tasks — JSON parsing, text extraction, counting, formatting. Use the available tools, `jq`, `node -e`, or an existing `pnpm` script instead. Ad-hoc scripts only for logic a one-liner cannot express; delete them when done.
- Don't change any code without explaining the reasoning.
- **Pencil visual truth:** `docs/design/padel-friend.pen` sets colors, typography, spacing, layout intent, overall look. Match visually as close as possible; implement with production UX, a11y, responsive and i18n best practices. Use fluid flex/percent sizing over literal fixed widths, Base UI over hand-rolled widgets, tokens over literal pixels, ≥44px touch targets, and layouts that tolerate translated text. Literal markup/implementation may differ. Pencil and Chromium rasterize fonts differently: pixel-identical output is neither required nor achievable; accept small cross-renderer pixel residuals. Review visual fidelity **and** engineering quality, not literal markup/pixel equality; never reject visually equivalent, better-engineered accessible work. Visual gates: exact structural/layout probes plus documented, justified nonzero per-screen screenshot tolerances; never widen budgets to mask structural defects. Design tokens live in `design-tokens/dist/*.css` after `pnpm tokens:build`.
- **NEVER** hardcode user-facing copy in components. All visible strings, labels, helper text, aria labels, and status text must go through the i18n system.
- **NEVER** hardcode CSS colors, spacing, radii, typography sizes, or other design values when an existing design token / CSS variable fits. Prefer semantic tokens first, primitive palette/space/typography variables second, and only ask for a new token when no existing token matches the design need.
- **NEVER** Change vitest coverage thresholds without approval
- **ALWAYS** Follow the same code standard for all files. Like CSS variable tokens usage.

## Toolchain notes

- E2E always runs against a fresh preview: `pnpm test:e2e` frees port 4173 before Playwright starts, and `playwright.config.ts` sets `reuseExistingServer: false`. Always run E2E via `pnpm test:e2e` (never a bare `playwright test`) so a leftover preview cannot serve a stale bundle. Filter specs with `pnpm test:e2e <spec paths>` (NO `--`): pnpm forwards trailing args to Playwright as filters; `pnpm test:e2e -- <paths>` passes the `--` through literally and silently runs the FULL suite. The port-free step must not live in `playwright.config.ts` — Playwright re-imports the config in every worker, which would kill the server it just started.
- Agents iterate with affected-file tests only (`pnpm exec vitest related --run <touched files>` or `pnpm test:changed`); `test:changed` diffs against `HEAD` (uncommitted changes), not the branch merge-base; `--passWithNoTests` means a green run may execute zero tests — full `pnpm test` per unit remains mandatory. Reserve `pnpm complete-check` for the local final delivery gate.
- Run every test command (`pnpm test`, `pnpm test:e2e`, integration suites, related/changed runs) with an explicit shell timeout of 1800000 ms (30 min). The timeout is a ceiling, not a wait: a command that finishes early returns immediately, so a generous timeout never adds waiting — never run a gate once just to measure its duration. `pnpm complete-check` chains static + test + E2E, so give it 3600000 ms. A gate killed by its timeout is re-run with a larger timeout — never recorded as a test failure or a partial result. DB-touching gates (`pnpm test`, `pnpm test:e2e` — both run `db:reset`) run serially, never concurrently.
- **Single-run policy (user mandate)**: run each test suite ONCE per delivery code state — if it passes, assume OK and move on. NEVER run a targeted lane and then the full suite for the same code state, and never rerun a green suite as confirmation. On a failure (including later flake), diagnose from logs/error-contexts first, fix if needed, then rerun the failing suite ONCE. Diagnosis reruns are only for cases logs cannot explain.
- CI topology: service-free `static` blocks parallel `unit`, `integration`, and `e2e`; final `CI / checks` aggregates all results and retains branch-protection continuity. `db:types:check` runs early in `integration` because `scripts/db-types.mjs` invokes `supabase gen types --local` and requires a live local schema. Dev work and tests share one local Supabase database: `pnpm test` and `pnpm test:e2e` run `pnpm db:reset` first (wipes local dev data — ~25s) so tests always start from migrated seed state; unit-only runs are DB-free.
- Integration runs in two phases via `scripts/run-integration.mjs`: the audited parallel-safe partition first, then everything else serially. `pnpm test` wraps both; `INTEGRATION_PHASE=parallel|serial` selects one phase for targeted runs; `INTEGRATION_SERIAL=1` is the rollback switch that restores fully-serial execution.
- `pnpm complete-check` runs ONE build, reused for the e2e webServer via the internal `E2E_GATE_PREBUILT=1` (set only when a working-tree + build-env-file hash matches the build; mismatch → fresh rebuild), and EACH test phase runs its own fresh `db:reset` (integration, then e2e): integration residue classes are not prunable by e2e `global-setup` (evidence 2026-11-07: 10/450 e2e failures on the integration-dirtied DB, 450/450 from a fresh reset). Standalone `pnpm test` / `pnpm test:e2e` each keep their own reset and always build fresh.
- `pnpm test:e2e:fast` is the iteration lane: same fresh reset + preview as `pnpm test:e2e`, but visual specs are excluded via the `VISUAL_GREP` constant from `scripts/e2e-shards.mjs` (caller `--grep`/`--grep-invert` flags are rejected so the filter cannot be cancelled). Full `pnpm test:e2e` remains the delivery gate.
- Pre-commit runs lint-staged then static checks (`complete-check --only=static`); pre-push runs unit tests only (`pnpm test:unit`). Run `pnpm complete-check` before claiming done. CI runs static, then unit/integration/E2E in parallel.
- Registry operations (`pnpm audit`/`view`/`install`) can hit transient `ETIMEDOUT`/`ENOTFOUND` (pnpm bundled-node fetch). Retry once, then fall back to `corepack pnpm <command>` or `pnpm install --frozen-lockfile --offline`; verify connectivity with `npm view`/`curl`.
- `docs/plan/**` are mid-task workflow artifacts and are excluded from `oxfmt`, so an unformatted bundle/findings file never fails the format gate.
- `pnpm complete-check` runs all local stages and reports every failure in one pass (no `&&` short-circuit). CI runs static first, then unit/integration/E2E in parallel only after static passes; final `checks` rejects failed, cancelled, or skipped phases.

## QA

`pnpm complete-check`

## Project Management

This project uses Linear for issue tracking and project management. GitHub is used for source control and Actions. Copilot review is enabled: on the FIRST push of a PR it is requested automatically; on every SUBSEQUENT push it must be re-requested explicitly. Verify the request landed via the PR history/timeline (a `copilot-pull-request-reviewer` review or `review_requested` timeline event) — NEVER via the `requested_reviewers` API field alone (it can stay empty even when the review is queued). If not yet logged, wait a bit and check again (up to 2 verification checks per attempt); after 3 failed REQUEST attempts, stop and report at the end that Copilot review could not be requested. The git-specialist agent owns this protocol.

## Conventions

- **Base branch**: `main` (this repo has no `develop`; `main` is the default/integration branch and PRs target `main`)
- **Branch**: `feature/[linear-issue-id]-[title]` using the full Linear issue identifier, for example `feature/PAF-123-score-engine`
- **Commit**: `[type]: [description]` (feat/fix/docs/style/refactor/test/chore)
- **Indent**: 2 spaces
- **Files**: snake_case/kebab-case | **Code**: camelCase
- **Units**: px
- **Linear Team**: `PadelFriend` (<https://linear.app/trystanworkspace2>)
- **Linear Project**: `PadelFriend` (<https://linear.app/trystanworkspace2/project/padelfriend-d3c1aed70a18/overview>)
- **Task Tracking**: Create Linear Issues first, then work on them.
- **Issue IDs**: Use Linear issue identifier as task ID reference (e.g., `PAF-123`)
- **Dependencies**: Use `Depends On` with issue links (e.g., `PAF-1`, `PAF-3`)
- **PR ↔ Linear linking**: the PR description **may/should** link the Linear issue it resolves (and the Linear issue links the PR). The issue identifier must **not** appear in the PR title or in any commit subject/body.
- **Never commit** machine-local or tool-pinned files (e.g. `mise.toml`, `.DS_Store`); they belong in `.gitignore`.

## NPM Dependencies

Whenever you need to install a new npm dependency, use the rules defined in .npmrc., like for example save-prefix=~

## MCP Priority (MANDATORY)

Bootstrap first (see Session bootstrap). Then:

- **Reads**: Serena MCP by default — `get_symbols_overview`, `find_symbol`, `find_referencing_symbols`, `read_file` with line ranges. Whole-file reads only when symbols cannot answer.
- **Edits**: `replace_symbol_body` / `insert_after_symbol` / `insert_before_symbol` for symbol-scoped changes; `replace_content` in regex mode for targeted text; `replace_in_files` for multi-file edits; `create_text_file` for new files.
- **Native fallback** only for: non-code files, short known-range reads, unique exact-text edits, or a session where Serena is unavailable (must be stated in the first progress update).
- **Never** mutate files via shell (`sed -i`, `cat >`, heredocs, `tee`).

## Development guidelines

- Use React 19, TanStack Start SSR on Workers, Supabase for backend, Base UI for interactive primitives.
- Create and track a Linear issue before feature work. Record dependencies in Linear. Branch `feature/TEAM-123-short-title`. The PR description **should link the Linear issue it resolves** (and the Linear issue should link back to the PR), but the issue identifier must **never** appear in the PR title or in any commit subject/body. Set the project's Linear workspace/team in `.linear.toml` after creating a repo.
- React components: `PascalCase.tsx`; other modules: `kebab-case.ts`; routes: TanStack file-route names; tests: `.test.ts` or `.spec.ts`.
- Structure: `src/routes` for routing, `src/features` for domain/server functions, `src/components` for reusable UI, `src/lib` for infrastructure, `src/i18n` and `src/locales` for copy, `design-tokens` for theme values.
- Use StyleX for component styles, Style Dictionary semantic CSS variables for theme values, and `src/styles.css` only for global reset. Use Base UI for accessible widgets.
- Translate all user-visible strings into en, pt-BR, es. Server-rendered locale must agree with hydration; avoid singleton i18next instances on the server.
- Use server functions for private data, verify auth with `getClaims()` inside each function, use RLS, and never expose service-role secrets to browser code. Avoid shared caching on authenticated responses.
- Google OAuth uses Supabase PKCE and `/auth/callback`; preserve the code-verifier/session cookies on redirects. Configure Google Client ID/Secret in Supabase Auth, never in `VITE_` env values. Follow `INITIAL_SETUP.md` for environment URLs and deploy credentials.
- Do not cache SSR HTML or Supabase authentication requests in the service worker. `VITE_` keys are public; only publishable keys belong there.
- Do not lower test coverage thresholds without agreement. `pnpm complete-check` is the quality gate; it must not modify source. No `--fix` in CI.
- Commit using Conventional Commits; Husky runs lint-staged, commitlint, and a unit-only pre-push gate. Run `pnpm complete-check` before claiming done.
