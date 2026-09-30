# PAF-21 player setup — design deviation

Reference: `docs/design/padel-friend.pen`, frame `PdRtP` (Onboarding — player setup); export: `e2e/references/paf-1/player-setup.png` (390×844).

- Match frame hierarchy through primary CTA: step badge, header, hero, name, level chips, preferred side, 10% reliability note, save button. Empty name/side remain empty until entered; frame's sample name and selected side are illustrative, not default user data.
- Keep required numeric level input after CTA in same form, labeled "exact starting level", to support 0.1 increments not represented by six chips. Validation focuses it and scrolls into view on invalid entry. Selected chip/output still reflects entered tenths.
- Keep optional dominant-hand select and bio textarea after CTA in same form. They remain labeled, keyboard-accessible and included in the same `onboardPlayer` call. These extra controls extend page below 390×844 reference; original PNG is not a full-page pixel baseline for this functional form. PAF-23/24 own visual tests and adapted references.
- At narrow widths or with longer translations, allow wrapping/scrolling rather than clipping labels or hiding inputs.
