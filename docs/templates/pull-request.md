<!--
Suggested PR title (Conventional Commits, matching the branch issue id):
    feat(deploy): add staging environment and promotion flow
Base branch: the branch this feature was created from (develop by default).
-->

## Summary

<!--
One or two sentences describing the overall change and its business value.
Focus on the "what" and "why", not the "how".
-->

## What was added

<!--
List the main areas of change, grouped by feature/module/domain.
For each area, describe what changed and list the key files affected.
Use bold for area names and backticks for file paths.
-->

### Area name

- **Description of change** — `path/to/file.ts`
- **Description of change** — `path/to/other-file.tsx`

### Another area

- **Description of change** — `path/to/file.ts`

## Migration note

<!--
If this PR includes schema changes, data migrations, or breaking changes,
describe the migration path and impact on existing data.
Write "N/A" if not applicable.
-->

N/A

## Test coverage

<!--
Report the test results. Include:
- Total test count and pass/fail status (run: `bun test tests/`)
- New test files added
- Existing tests that were updated
- For infra/deploy PRs: what was validated without a live run
  (YAML parsing, tripwire hashes, dry runs) and what remains pending

The suite is pure behavioral gates (zero LLM/network/DB). There is no
coverage tooling configured — report percentages only if that changes.
-->

- **Tests passing**: X/Y (`bun test tests/`)

### New tests

- `path/to/new-test.test.ts` — description of what is covered

### Updated tests

- `path/to/updated-test.test.ts` — what changed

## QA

<!--
List the quality gates that were validated.
Check off each item ONLY with real evidence (never self-reported success).
Leave unchecked whatever could not be validated, with the reason.
-->

- [ ] `bun run build` passed
- [ ] Behavioral gates (`bun test tests/`) passed
- [ ] Lint — excluded from pipeline (pre-existing ~6.7k prettier debt; project forbids global autofix)
- [ ] Live validation performed (deploy/infra PRs: first green workflow run on the target branch)

## Risk

<!--
Assess the risk level of this change.
Level: Low | Medium | High
Include mitigation strategy for Medium/High risk.
-->

**Level**: Low

**Details**: N/A

## Issue link

<!-- Required: link the issue this PR closes (feature/ORI-N branches). -->

Closes #0
