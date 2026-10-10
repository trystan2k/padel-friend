# Dependency Remediation — PAF-53 Tier 1 (security)

## Metadata

- Date: 2026-10-10
- Scope: Dependabot vulnerabilities on the default branch (`main`)
- Sources: GitHub Dependabot alerts (via `gh`) + `corepack pnpm audit`
- Branch: `feature/PAF-53-tier-1-security-tooling-privacy`

## Before

Dependabot reported 10 open alerts (2 critical, 3 high), all in `pnpm-lock.yaml`:

| Package       | Severity                | Vulnerable range       | Fixed  |
| ------------- | ----------------------- | ---------------------- | ------ |
| undici        | 1 high, 2 medium, 3 low | `< 7.29.1`             | 7.29.1 |
| tinypool      | 2 critical              | `<= 2.1.0` / `< 2.1.2` | 2.1.2  |
| sharp         | 1 high                  | `< 0.35.5`             | 0.35.5 |
| source-map-js | 1 high                  | `>= 1.0.0, < 1.2.2`    | 1.2.2  |

`pnpm audit` also surfaced one additional high: `braces` (`<= 3.0.3`, GHSA-vfj7-8cjw-p6xm).

## Remediation

Applied as `overrides` in `pnpm-workspace.yaml` (pnpm 11 setting location) to force the patched transitive versions:

| Package       | From   | To     | Mechanism                                                                                  |
| ------------- | ------ | ------ | ------------------------------------------------------------------------------------------ |
| sharp         | 0.35.4 | 0.35.5 | override `sharp@<0.35.5`                                                                   |
| tinypool      | 2.1.0  | 2.1.2  | override `tinypool@<2.1.2`                                                                 |
| undici        | 7.29.0 | 7.29.1 | override `undici@<7.29.1` (the `undici@8.11.2` tree via jsdom is unaffected and untouched) |
| source-map-js | 1.2.1  | 1.2.2  | override `source-map-js@<1.2.2`                                                            |

## After

`corepack pnpm audit`: `{ critical: 0, high: 1, moderate: 0, low: 0 }`.
All critical/high Dependabot advisories are resolved.

## Accepted exception — braces (high, GHSA-vfj7-8cjw-p6xm)

- Advisory: `braces <= 3.0.3`, claimed fixed `>= 3.0.4`.
- Fact: the newest published `braces` release is **3.0.3** (verified via `npm view` and `pnpm view`); no `>= 3.0.4` version exists, so no patch can be applied.
- Exposure: transitive glob-matching library reached only through `stylelint > fast-glob/globby > micromatch > braces` (dev-time tooling). No runtime, Worker, browser, or server-function exposure.
- Mitigation: monitor the upstream `braces` release; re-run remediation once a `>= 3.0.4` release ships.

## Environment note

The mise-managed standalone `pnpm` binary could not reach the npm registry in this environment (fetch layer failed with ENOTFOUND / error 23). Registry operations were run with `corepack pnpm` (pinned pnpm 11.0.8 on system Node), which resolves correctly.
