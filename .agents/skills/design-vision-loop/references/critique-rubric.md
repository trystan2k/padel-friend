# Vision Critique Rubric

Score each screenshot against these dimensions. One hard FAIL means `ITERATE`. The conformance target is the matching frame and design variables in `design/origin.pen`.

| Dimension | Pass condition | Common defects |
|---|---|---|
| token-conformance | Colors, type, and spacing match the Pen design variables (via StyleX tokens) | Off-palette color, wrong type scale, ad-hoc spacing |
| hierarchy | Exactly one primary action stands out per screen | Two competing CTAs, no focal point, flat emphasis |
| spacing-rhythm | Consistent spacing scale; related items grouped, unrelated separated | Cramped clusters, uneven gaps, no vertical rhythm |
| responsive | No overflow, clipping, or overlap at any captured viewport | Horizontal scroll on mobile, clipped text, off-screen controls |
| dark-mode | Parity with light: contrast holds, nothing disappears | Unreadable text, un-themed hard-coded surfaces, lost borders |
| contrast-a11y | Text and controls meet WCAG 2.2 AA contrast | Low-contrast body text, accent-on-accent labels |
| spec-match | Layout matches the Pen frame at structure level | Regions reordered, component missing, proportion drift |

## Scoring discipline

- **Look before scoring.** Cite what the screenshot shows ("at 375px both buttons use the accent color, so the primary action is ambiguous"), not what the code should produce.
- **Per viewport.** A defect at one width is a defect; record the viewport.
- **Expected vs actual.** Every defect names the element, the viewport, the expected state from the Pen design, and the observed state. Resolve vague notes ("feels off") into a dimension above or drop them.
- **Structure, not pixels.** For `spec-match`, compare layout, hierarchy, and rhythm against the Pen frame; browser and Pen rendering differ, so a pixel-perfect match is not the bar.
