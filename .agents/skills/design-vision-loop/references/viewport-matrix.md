# Viewport Matrix

Default capture set for the vision loop.

| Name | Width | Height | Why |
|---|---|---|---|
| mobile | 375 | 812 | Overflow and touch targets; the width most UI breaks at |
| tablet | 768 | 1024 | Grid reflow boundary, where columns collapse or expand |
| desktop | 1440 | 900 | Primary design width; hierarchy and whitespace read here |

## Dark mode

Capture desktop (1440) a second time after `playwright-cli set-color-scheme dark`. Add a mobile dark capture only when the UI has mobile-specific dark surfaces. Skip, and note it, if the Pen design has no dark theme.

## Trimming or extending

- **Single component** → mobile and desktop only, unless it reflows at tablet width.
- **Data-dense dashboard or table** → add 1920×1080; wide layouts hide overflow at 1440.
- Keep the set small: each capture costs a critique pass. The default is 3 widths + 1 dark = 4 captures per route.
