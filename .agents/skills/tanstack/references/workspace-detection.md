<!-- Vendored copy. Source of truth: the repo-root references folder, file workspace-detection.md. Edit it there, then run scripts/sync-references.sh. -->

# Workspace detection

Reusable skills must not assume a repo shape. Before writing files or running tooling, detect whether the repo is a **standalone app**, a **monorepo**, or a **library**, then adapt paths and where commands run. Skills reference this file instead of hardcoding a layout.

## Detect the shape

Check monorepo markers **first** — a monorepo contains apps and libraries inside it.

| Shape | Signals (at repo root unless noted) | Act where |
| --- | --- | --- |
| **Monorepo** | `pnpm-workspace.yaml`; or `"workspaces"` in `package.json`; or `turbo.json` / `nx.json` / `lerna.json` / `rush.json`; multiple `package.json` under `apps/*`, `packages/*` | Package-level tooling runs in (or targets) the owning package; repo-wide config stays at the root |
| **Standalone app** | one `package.json`, app deps (e.g. a framework + bundler), **no** workspaces field or workspace file; builds to an app bundle | Root |
| **Library** | `package.json` with `exports` / `main` / `module` / `types`; usually `peerDependencies` and often `"private": false`; library-mode build (tsup, rslib, `vite build --lib`, etc.) | The package itself |

A package inside a monorepo is itself either an app or a library — classify it with the same signals.

### Detection commands (run from the repo root)
```sh
# monorepo markers
ls pnpm-workspace.yaml turbo.json nx.json lerna.json rush.json 2>/dev/null
grep -l '"workspaces"' package.json 2>/dev/null

# enumerate packages (skip node_modules)
find . -path '*/node_modules' -prune -o -name package.json -print

# library signals in a given package.json
grep -E '"(exports|module|types|peerDependencies)"' <path>/package.json
```

## Adapt by shape

- **Where commands run.** Standalone: repo root. Monorepo: in the owning package, or via the task runner — `pnpm -F <pkg> <script>`, `turbo run <task> --filter=<pkg>`, `nx run <pkg>:<target>`. Library: the package dir.
- **Repo-wide vs package-local.** Commit hooks, release automation, `AGENTS.md`/`GLOSSARY.md`, CI, and the skills themselves belong at the **repo root** so every package shares them. Build/test/lint config belongs to the **package** it serves.
- **Skill install location.** Install skills at the repo root (`./.claude/skills/` or `./.agents/skills/`) so all packages share them. Only give a package its own skills folder if it genuinely needs different guidance.
- **Shared dependencies (monorepo).** Framework singletons (`react`, `react-dom`, router, state libs) must be deduped/hoisted. If a dependency catalog exists (pnpm `catalog:`), pin shared versions there rather than per-package.
- **Libraries don't bundle the framework.** In a library, `react`/`react-dom` are `peerDependencies`, not `dependencies` — don't bundle or pin them into the output.

## Rule of thumb
Detect first, then choose paths. Never assume `apps/web`, a single root `src/`, or any one project's layout — ask the filesystem.
