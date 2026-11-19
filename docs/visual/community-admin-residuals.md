# Community-admin visual residuals

Superseded by the PAF-202 clubhouse redesign. The legacy pixel-count caps and mask rectangles for the old frames no longer apply.

Current evidence: `e2e/references/paf-202-community-admin/manifest.json` (frame hashes, Chromium baselines, tolerance justification). Structure is gated by the exact geometry probes in `e2e/community-admin.spec.ts`; pixels by per-screen Chromium baselines at `maxDiffPixelRatio` 0.01.
