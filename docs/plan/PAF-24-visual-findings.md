# PAF-24 — Pencil visual comparison (structural gate and final UX sign-off complete — ship)

Run: `pnpm exec playwright test e2e/auth-visual.spec.ts --project=chromium --reporter=list --workers=1`. Captures: 390×844, DPR 1, light, en; hydrated root, fonts and images ready; animation disabled, caret hidden. The source-design SHA-256 is recorded in `e2e/references/paf-1/manifest.json` as provenance metadata only and is not runtime-enforced; approved reference PNG and derived-baseline digests are enforced by the gate. On 2026-10-01, the user re-approved references re-exported at 1× with pen CLI 0.3.10 from a temporary copy of the format-2.20 design; each image is 390×844. The source `.pen` remains untouched, and `account-adapted.png` is byte-identical to the new `account.png`. Each screenshot baseline is hash-checked against its approved source or deterministic source-derived image before and after comparison, so `--update-snapshots` cannot silently accept a browser capture.

## Design fidelity policy

`docs/design/padel-friend.pen` is visual truth for colors, typography, spacing, layout intent, and overall look. Match it as closely as possible while using production UX, a11y, responsive, and i18n practices; literal markup can differ (fluid flex/percent sizing, Base UI, tokens, ≥44px targets, translation-safe layouts). Pencil/Chromium font rasterization makes pixel identity unattainable. UX/UI, code, and architecture review should judge visual fidelity **and** engineering quality, not literal equality; do not reject visually equivalent accessible improvements. Gate meaningful structure with exact layout probes and per-screen documented, justified nonzero screenshot budgets; never widen budgets to conceal geometry defects.

## Re-approved CLI 0.3.10 references and remeasurement (2026-10-01)

The user explicitly re-approved the new PAF-1 references. `docs/design/padel-friend.pen` remains unchanged (SHA-256 `7cf0039337478833c64b3f3e5d8271bb3bd35f395dfd534af02200f8e3358875`). pen CLI 0.3.10 exported frames `wzWLt`, `EGb2g`, and `PdRtP` from a temporary copy using the command recorded in `e2e/references/paf-1/manifest.json`; each PNG is exactly 390×844. The `account-adapted.png` reference and baseline are byte-identical to the new `account.png` export.

The player mask remains limited to the approved display-name and selected-Right sample regions. Pixel inspection found the first antialiased name glyph column at x=31 (previous rectangle began x=32), so the name mask moved left one pixel while preserving its right edge. The selected Right fill reaches y=539 (previous mask ended at y=536), so its mask height increased by three pixels to end at y=540. Final rectangles: name `{ x: 31, y: 258, width: 111, height: 22 }`; Right `{ x: 139, y: 493, width: 112, height: 47 }`. No other region is masked. All existing ±1px structural probes passed unchanged against the new exports.

Diff measurement uses Playwright's color threshold **0.1** over 329,160 pixels. Previous values below are the 2026-09-30 recorded measurements; new counts come from forced-zero-tolerance runs against the CLI 0.3.10 references, then pass under the calibrated caps. Keep at least 0.10 percentage-point headroom; no cap exceeds that necessary margin. Pre-task code caps were 2.80%, 3.20%, and 3.15% respectively.

| Screen                    | Previous recorded residual |        CLI 0.3.10 measurement |        Change | Final cap | Headroom |
| ------------------------- | -------------------------: | ----------------------------: | ------------: | --------: | -------: |
| Welcome / `wzWLt`         |                    2.9357% | **8,702 / 329,160 = 2.6437%** |     −0.2920pp | **2.75%** | 0.1063pp |
| Account / adapted `EGb2g` |                    1.6749% | **9,779 / 329,160 = 2.9709%** | **+1.2960pp** | **3.08%** | 0.1091pp |
| Player / `PdRtP`          |                    2.6723% | **9,740 / 329,160 = 2.9590%** | **+0.2867pp** | **3.06%** | 0.1010pp |

Welcome residual improved and its cap tightened from 2.80% to 2.75%. Account residual increased by 1.2960pp and player by 0.2867pp; both increases are explicit, while caps still tightened from 3.20% to 3.08% and 3.15% to 3.06%. No structure probe or coverage threshold changed.

## Historical measurement (2026-09-30; superseded by the CLI 0.3.10 re-export)

The final gate checks element `boundingBox()` geometry against frame-local design coordinates to **±1px** on each asserted axis, then compares the full 390×844 viewport with per-pixel color threshold **0.1**. Final measured `maxDiffPixelRatio` results: Welcome **2.9357% / 3.3% cap**, account **1.6749% / 1.9% cap**, and player **2.6723% / 2.8% cap**. All remain within the existing budgets; no threshold or budget was widened. Exactly two PAF-21 approved sample-data rectangles are applied to both player images with opaque `#FF00FF`: display-name value `{ x: 18, y: 246, width: 110, height: 30 }` and selected Right chip `{ x: 139, y: 477, width: 112, height: 52 }`. The screenshot baseline is deterministically regenerated from the approved player reference using those masks; approved reference PNG and derived-baseline digests are runtime-checked before and after comparison. `sourceDesign.sha256` is provenance metadata only and is **not** runtime-enforced. No other region is masked. Determinism: 390×844, DPR 1, light theme, en cookie/en-US browser, concrete root hydration marker, fonts.ready and image decode, fixed time, animations disabled, caret hidden.

### Structural probes (frame-local x, y, width, height; omitted axes not asserted)

| Frame         | Element             | Asserted coordinates (px) |
| ------------- | ------------------- | ------------------------- |
| wzWLt         | Header              | (18, 24, 354, —)          |
| wzWLt         | Google CTA          | (18, —, 354, 50)          |
| wzWLt         | Email input         | (18, 418, 354, 48)        |
| wzWLt         | Password input      | (18, 501, 354, 48)        |
| wzWLt         | Login CTA           | (18, 563, 354, 50)        |
| EGb2g         | Step badge          | (18, 18, —, 25)           |
| EGb2g         | Header              | (18, 55, 354, —)          |
| EGb2g         | Hero                | (18, 116, 354, 100)       |
| Adapted EGb2g | Form card           | (18, 230, 354, —)         |
| Adapted EGb2g | Email control       | (32, 268, —, 40)          |
| Adapted EGb2g | Password control    | (—, 341, —, 40)           |
| PdRtP         | Step badge          | (18, 18, —, 25)           |
| PdRtP         | Hero                | (18, 116, 354, 97)        |
| PdRtP         | Name card           | (18, 225, 354, 52)        |
| PdRtP         | Level card          | (18, 289, 354, 143)       |
| PdRtP         | Level heading label | (31, 302, —, —)           |
| PdRtP         | Scale caption row   | (31, 404, 265, —)         |
| PdRtP         | ADVANCED caption    | (230, 404, —, —)          |
| PdRtP         | Selected 3 chip     | (142, 351, 51, 44)        |
| PdRtP         | Preferred side card | (18, 444, 354, 94)        |
| PdRtP         | Save CTA            | (18, 667, 354, 44)        |

Unasserted axes are deliberate: StepBadge text width is font-renderer dependent; Welcome Google CTA top differs 2.5px from Pencil while email/password/login controls match ±1px; account email control spans 328px vs 326px reference because its shared card uses tokenized 13px padding instead of literal 14px. Changing card padding to available 14px token increased full-screen diff from ~1.66% to ~2.08%, shifting other card content; reverted rather than masking or enlarging screenshot budget. These small residuals remain visible in the unmasked comparison and are **not** a pretext to relax asserted geometry. Other structural drift on asserted elements fails independently of screenshot noise.

| Screen                  | Earlier exact comparator (no masks, threshold 0) | Final measured comparator (threshold 0.1, final budget) | Remaining evidence                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | -----------------------------------------------: | ------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome / wzWLt         |                         21,351 / 329,160 (6.49%) |                               **2.9357%**, PASS at 3.3% | Google label now uppercase from locale strings; translated stack with margin spacing, not transforms. Remaining typography strokes, thin outlines and some ~1px geometry differ.                                                                                                                                                                                                                                        |
| Account / adapted EGb2g |                         12,275 / 329,160 (3.73%) |                               **1.6749%**, PASS at 1.9% | Password control 44→40px, top y341, bottom y380 matching adapted reference; helper actual y392–403 vs reference y393–404 (~1px). Card/CTA now ~1px from target; prompt adjusted ~2px. Badge semibold browser ink x28–165 vs reference x28–172; renderer/text-width difference persists.                                                                                                                                 |
| Player / PdRtP          |                         32,032 / 329,160 (9.73%) |             **8,796 / 329,160 (2.6723%)**, PASS at 2.8% | Prior one-sided mask counted magenta against design ink and reported 16,725 (5.08%); symmetric masking excludes only approved sample-data rectangles. Label/caption geometry now has direct ±1px probes. ADVANCED remains inset near reference x230–294; browser ink x229–295. Badge text/browser glyph metrics remain narrower. Empty name and unselected side remain intentional, masked only in approved rectangles. |

### Final accepted deviations (UX/UI verdict: ship)

- **Renderer residuals:** Inter/Manrope glyph rasterization and width differences, thin outlines, and small ink/geometry offsets remain inside the final per-screen budgets. Welcome Google CTA top differs about 2.5px; the account email control is 328px wide versus the 326px reference because the shared card uses the available tokenized 13px padding; account helper text differs about 1px. Step-badge ink is about 6–7px narrower than Pencil, and player ADVANCED ink spans x229–295 versus x230–294. No invented tracking, extra masking, or budget increase was used.
- **Accessible adaptations:** Painted account inputs remain 40px high while their interactive hit areas meet 44px; placeholder text uses the muted design token at full opacity for WCAG AA contrast; localized labels and native form semantics remain intact.
- **Functional adaptations:** The approved account frame replaces its magic-link helper/action with password signup and CREATE ACCOUNT; account controls remain inert before hydration so credentials cannot leak through a native GET; player name and preferred side remain intentionally blank/unselected, with only their approved sample-data areas masked in both comparison images. CTA capitalization comes from localized strings rather than CSS transforms.

Placeholder glyphs previously used Chromium UA grey `rgb(117,117,117)`; filled account control gave **4.30:1**, below WCAG AA **4.5:1**. Shared `TextField` control, standalone account email control, and player `ui.input` now declare `::placeholder { color: var(--color-muted); opacity: 1 }`. Remaining journey numeric input/select/textarea share `ui.input`; select options are not placeholders. Account password control and email both 40px; account control→helper spacing uses 3px top and 2px bottom margin on password control to reproduce adapted frame without changing shared fields. Badge now uses design-specified semibold; tracking not added because design specifies none and no matching fine-grained token exists.

**ADVANCED source determination:** PdRtP `yw8px` is a _single_ Inter 12 semibold text object, content `BEGINNER                                         ADVANCED`, not a two-item `space-between` row. This explicitly positions ADVANCED inside the card; old right-alignment was wrong. Caption row now constrains its flex content width to reproduce the exported inset. Glyph-width/raster differences of ~1–2px remain.

Desktop: login, account and player journey pages use a centered max-width of `calc(var(--space-40) * 12)` with border-box sizing. At 390px this retains full-width 18px inset; 390×844 screenshots remain the regression target. Buttons rely on uppercase localized CTA strings rather than CSS text-transform; Google locale strings are explicitly uppercase in en/pt-BR/es. The Google “G” mark explicitly uses `color: var(--color-green)`, resolving to `#0E714D` in the light theme (`rgb(14, 113, 77)` in Chromium); it does not inherit the secondary button’s dark text color.

**Badge source determination (one investigation):** EGb2g `COjNa` and PdRtP `esyei` both specify `fontFamily: Inter`, `fontWeight: semibold`, `fontSize: 12`; neither defines `letterSpacing`. `src/components/ui/step-badge.styles.ts` uses `--font-family-body` (Inter), `--font-weight-semibold`, `--font-size-12`, with no tracking. The ~6–7px narrower Chromium text ink (account x28–165 vs Pencil x28–172, same player pattern) cannot be attributed to a reproducible source-style difference. Accepted renderer-specific glyph-width deviation; **no tracking invented**. Badge x/y/height remain structurally probed; width remains in screenshot regression signal.

Final gate: all **6 Chromium tests** in the auth visual spec pass; 3 frame screenshots use per-screen budgets and structural probes. The player screenshot measured 2.6723% after symmetric masking against a 2.8% cap. Final UX/UI review verdict: **ship**. The remaining documented renderer residuals and accessible/functional adaptations below are accepted; budgets and structural probes remain unchanged. The screenshot gate targets 390×844 and does not assert 320px, desktop, or translated-overflow layouts.

## Reference provenance

`sourceDesign.sha256` records provenance metadata only; the runtime gate does not verify this source hash. The gate does verify every approved reference PNG digest and every derived-baseline digest before/after screenshot comparisons. These enforcement boundaries are explicit in `e2e/references/paf-1/manifest.json`.

The account adaptation now lives directly in the approved `EGb2g` source frame. `e2e/references/paf-1/account-adapted.png` is a byte-identical copy of the new `account.png` export; no extra copied or modified design frame was used. All three references were regenerated from a temporary copy using pen CLI 0.3.10; exact command, current source-design SHA-256, and approved image digests are recorded in `e2e/references/paf-1/manifest.json`. Source `docs/design/padel-friend.pen` was not edited. Browser-generated snapshots must never replace design references.
