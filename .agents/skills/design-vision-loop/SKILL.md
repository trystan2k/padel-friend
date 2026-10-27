---
name: design-vision-loop
description: "Vision feedback loop for UI: render the running app with playwright-cli, screenshot it across viewports and dark mode, run deterministic gates, then critique the screenshots against the Pen design (design/origin.pen) and iterate until it passes. Use after building or changing a UI page or component, or when asked to check that the UI looks right or matches the design."
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash
---

# Design Vision Loop

Correct code can still render wrong; nobody looked at it. This skill closes the loop: **render → capture → gate → critique → fix**.

## Precondition

The UI must render: a running dev server (`bun run dev`, or the URL the caller gives) and a route that shows the change. If nothing renders (a component with no route or harness), say so and stop — never critique code you have not seen rendered.

The design reference is the matching frame in `design/origin.pen`. If the file or frame is missing, report it and critique against the rubric without the `spec-match` dimension.

## The loop (max 3 iterations)

### Step 1 — reference (Pen, read-only)

Load the target frame from `design/origin.pen` with the Pen tools: `mcp__pencil__get_app_state`, then `mcp__pencil__execute` using only `Get`, `GetVariables`, `Print`, and `TakeScreenshot([frameId])`. Keep the screenshot and the design variables (colors, type, spacing) as the conformance target. Read only — never use the `pen-design` generator or any mutating `execute` call here.

### Step 2 — capture (playwright-cli)

For each viewport in [`references/viewport-matrix.md`](references/viewport-matrix.md):

```bash
playwright-cli open http://localhost:<port>/<route>
playwright-cli resize 375 812
playwright-cli screenshot --filename=test-results/vision/<route>-mobile.png
playwright-cli resize 768 1024
playwright-cli screenshot --filename=test-results/vision/<route>-tablet.png
playwright-cli resize 1440 900
playwright-cli screenshot --filename=test-results/vision/<route>-desktop.png
playwright-cli set-color-scheme dark
playwright-cli screenshot --filename=test-results/vision/<route>-desktop-dark.png
playwright-cli clear-color-scheme
```

`test-results/` is git-ignored; screenshots are evidence, not artifacts to commit. If the design has no dark theme, skip the dark capture and note it.

### Step 3 — deterministic gates (run before any critique)

- `playwright-cli console` — runtime errors, failed requests, and React warnings are defects regardless of looks.
- Token check on the changed style files: every StyleX style uses design tokens (`defineVars` variables or `stylex.types.*`), never literal hex, `px`, or font values.
- `bun run lint` and `bun run typecheck` on the change.

Fix every gate failure before spending a critique pass.

### Step 4 — vision critique

Read each screenshot with the `Read` tool and score it against [`references/critique-rubric.md`](references/critique-rubric.md), comparing to the Pen reference at layout level. Output a verdict:

- `status`: `PASS` or `ITERATE`
- `defects[]`: `element`, `viewport`, `expected` (from the Pen design or rubric), `actual` (what the screenshot shows)

### Step 5 — iterate

Fix each defect (load `refactoring-ui` for hierarchy, spacing, color, or depth defects), then re-enter Step 2. Stop at `PASS` or after 3 iterations; at the cap, report the remaining defects instead of looping.

### Step 6 — teardown

Run `playwright-cli close` as soon as you reach `PASS` or the cap. An open browser outlives the task.

## Output

Write the verdict, screenshot paths, and defect log to `test-results/vision/report-<route>.md` and return its path, so a reviewer or the user can see the evidence. Every "looks good" claim cites a screenshot.

If you could not render, could not capture dark mode, could not load the Pen frame, or hit the cap, say which. A skipped check reported as passed is the failure this skill exists to prevent.
