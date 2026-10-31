## Task Analysis

- Main objective: Deliver PAF-9 / “T09 — Approve V1 global-rating calibration and golden outcomes”: approved, replayable V1 calibration specification plus machine-readable golden outcomes for PAF-10. HITL documentation/data delivery only; this plan does not implement either artifact.
- Identified dependencies:
  - PAF-7 (Done per supplied Linear intake), agreed teams/outcomes. Dependency reference: Linear PAF-7; local contract context: docs/tasks/09-rating-calibration-approval.md. No unavailable prerequisite identified. Do not invent a Linear issue URL; parent retains actual issue links.
  - PAF-125 provisional-player decisions are folded into this delivery, not deferred. PAF-10 consumes this contract and must not start implementation against unapproved fixtures.
  - Binding approval source: human sign-off relayed in caller intake. Preserve provenance accurately; do not invent approver identity, approval timestamp, or approval of fixtures not yet reviewed.
  - Sources inspected: .opencode/agents/delivery-orchestrator.md Completion-First Policy; docs/tasks/09-rating-calibration-approval.md; docs/tasks/10-global-rating-and-history.md; docs/prd/padel-friends-prd-v1.md §§25–27; src/features/player/rating-config.ts; supabase/migrations/20260928000000_player_profiles_and_ratings.sql.
- System impact:
  - No product code, migrations, npm dependencies, persisted test helpers, src/test files, engine implementation, or coverage changes. Final deliverables: docs/rating/v1-calibration.md and docs/rating/golden-fixtures.json, plus this workflow plan.
  - Existing mu storage is numeric(4,2), constrained to 0–7; sigma initializes at 1.00; configuration exports engine app-wide-level / 1.0.0. LEVEL_STEP=0.1 governs initial selection, not post-match rounding. Current state table lacks rating_config_version: document future event contract, do not change schema here.
  - T10 already owns engine, immutable ledger, projection/retry handling, UI and regression tests. Its separate PAF-8 dependency does not block this calibration task. No unrelated enhancement scheduled.

## Chosen Approach

- Proposed solution: One normative Markdown specification, one self-contained JSON fixture document. Explicit metadata, fully expanded player states and expected results, sequential scenarios where ordering/history matters, and cross-case invariance assertions. Human-readable fixture inventory and approval evidence live inside specification; no third persistent schema/helper/report artifact.
- Justification for simplicity:
  - Selected paired spec + JSON: readable approval surface, direct T10 Vitest consumption, independent expected values.
  - Rejected Markdown-only tables: cannot reliably serve machine-readable regression contract.
  - Rejected per-case files plus schema package/generator or engine prototype: unnecessary fragmentation and implementation scope. JSON contract documented in specification suffices; scratch verification can remain ephemeral.
  - Approved mathematical model is fixed, not one of the remaining options. No mandatory TrueSkill implementation or alternate coefficient search.
- Components to be modified/created:
  - Create docs/rating/v1-calibration.md: normative calculation, fixture contract/inventory, worked explanations, fairness resolutions, approval record and verification evidence.
  - Create docs/rating/golden-fixtures.json: versioned input/output oracle, not executable product code.
  - Do not edit PRD, rating-config.ts, task documents, locale catalogs, schema, tests, or unrelated files.

## Implementation Steps

1. Freeze inputs and enumerate acceptance coverage before authoring.
   - Reconcile caller-approved package with cited sources. Record all three binding decisions: formula package, version tuple, provisional treatment.
   - Record engine='app-wide-level', engine version='1.0.0', configuration version='1' as strings. Separate fixture-format version from rating configuration version.
   - Capture scope exclusions and provenance. Existing sign-off approves parameters; final golden fixtures still require actual human review. No routine reapproval of unchanged coefficients.
   - Check existing docs/rating artifacts before creation; preserve unrelated work. If authoritative source contradicts supplied approval, surface exact evidence to parent before proceeding rather than silently choosing a rule.

2. Write normative specification and calculation contract (AC1, AC5).
   - Parameter table: team strength S=(mu1+mu2)/2; E=1/(1+10^((Sopp−Sown)/2.0)); O=1 / 0.5 / 0; K(r)=0.30×(1−0.75×r/100); raw_delta=K(r_before)×(O−E).
   - Eligibility: complete, Confirmed Competitive playing quartet only. Friendly, Incomplete, Pending and Disputed leave rating/reliability untouched. Use existing result vocabulary; do not assume Incomplete is same enum axis as review status. Document additional existing exclusion semantics without implementing T10 eligibility logic.
   - Read all four pre-group states once. Compute both strengths/probabilities before updating anyone. Use pre-group reliability for K; update all four simultaneously. No opponent/partner update may affect another participant within same group.
   - Define precision stages explicitly: no intermediate rounding; projected_mu=mu_before+raw_delta; one half-away-from-zero rounding to 2dp at final per-player state; clamp to [0,7]; mu_after=display_after; applied_delta=mu_after−mu_before. Keep raw_delta separate from displayed/applied delta. Explain that rounding raw_delta first is NOT an interchangeable instruction at midpoint ties. Present this operational interpretation in final human artifact review; if approver intended delta-first rounding, obtain explicit resolution before fixtures are finalized.
   - Express round2(x)=sign(x)×floor(abs(x)×100+0.5)/100 mathematically. Normalize negative zero. No generic epsilon that changes mathematical ties. Fix machine numeric encoding in step 3; transcendental E needs documented precision/tolerance, not a claim of exact finite decimal representation.
   - After eligible group: n_after=n_before+1; r_after=min(100,10+6×n_after); sigma stays 1.00. At n=14→15 reliability moves 94→100; n≥15 stays 100. Even equal Draw or rounded/clamped zero movement increments count/reliability.
   - Replay groups by ascending (played_at instant, group_id canonical UUID ordering), using quantized/clamped output state as next input. Require canonical IDs/timestamps, not locale-dependent comparison or input-array order. Propose played_at as last_rating_at for ratable groups and highest_after=max(highest_before,display_after); label these supporting field semantics for final review, not previously approved new policy.
   - Initialization: declared/creator-estimated starting level sets mu/display identically, n=0, reliability=10, sigma=1.00. Claim retains user ID, state and history. First creator-entered initial level persists against subsequent adders.
   - Explicit fairness resolutions: asymmetric reliability allows non-zero-sum group changes; arithmetic mean gives partners same E but distinct K; 100% still moves (K=0.075), not certainty; low reliability K=0.2775; mismatches may round movement to zero; boundaries truncate applied gains/losses without blocking reliability; equal Draw supplies a confirmed observation despite zero delta; sigma has no hidden effect; score margin and League standings never influence global skill. No copied +0.08/+0.04 coefficient requirement from illustrative PRD examples.

3. Specify JSON contract before filling values (AC1–AC3, provisional addendum).
   - Top-level fixture_format_version, engine/configuration tuple, source/spec reference, numeric comparison policy, cases. Stable case IDs and requirement tags support explicit AC mapping.
   - Each case: description, initial per-player state keyed by stable user UUID, team assignments, groups/events, input match ID, optional League/community identifiers, outcome, match type, completeness/review status, played_at and group_id. Include optional scores only for margin-invariance pairs; scores must agree with outcome.
   - Per-player state: mu, display_level, sigma, reliability_percent, confirmed_competitive_game_groups, highest_display_level, last_rating_at. Inputs obey r=min(100,10+6n); do not manufacture impossible reliability/count pairs.
   - Expected per-group outputs: eligibility/event count, strengths, per-team E, per-player raw delta and applied delta, complete after-state and event version tuple. Rejected groups and claim operations emit zero rating events and preserve timestamps/highest/state/history. Non-ratable E may be null/not-applicable: distinguish no calculation from genuine E=0.
   - Use fixed-point decimal strings for authoritative two-decimal values and sufficiently precise decimal strings for E/raw_delta. Document parsing, exact cent comparisons, and tight absolute probability tolerance (e.g. 1e-12). Values near rounding boundaries require higher-precision verification, not looser tolerance. Counts/reliabilities remain integers.
   - Multi-step cases include expected state after EACH operation and expected event ordering, not final snapshots alone. Expanded states avoid fixture-builder dependencies; T10 may build an adapter later without changing oracle values.

4. Populate complete golden matrix, using all-four-player expectations (AC2, AC3, addendum).
   - expected-win-loss: stronger team wins; all winners/losers checked.
   - upset-win-loss: same pre-state, weaker team wins; gains/losses larger than expected counterpart at matching reliability.
   - equal-draw: E=0.5, zero applied delta, count/reliability advance.
   - near-equal-draw and weaker-team-draw: correct directional evidence; explicitly allow tiny evidence to round to zero.
   - extreme-mismatch: teams near opposite scale ends; finite complementary E, correct outcome directions, no invalid scale values.
   - mixed-reliability: one low-reliability partner and established partner against same opponents; different per-player deltas from same E. Include same-strength counterpart cases changing partner/opponent strength to demonstrate both matter.
   - first-group: n=0/r=10 changes level and becomes n=1/r=16. Include n=5/r=40, n=10/r=70, n=14/r=94→15/r=100, and established n≥15 transitions.
   - upper/lower clamps: winning player at/near 7 with weaker partner, losing player at/near 0 with stronger partner; projected_mu exceeds scale, state clamps, applied delta uses actual movement. Include outward movement at exactly 0/7.
   - rounding-midpoints: analytically construct positive/negative raw-delta half-cent ties (equal-strength win/loss at n=5/r=40 gives K=0.21, O−E=±0.5, raw ±0.105); verify final-state rounding, plus below/above-midpoint cases and zero normalization.
   - exclusions: distinct Friendly Confirmed, Competitive Incomplete, Competitive Pending, Competitive Disputed cases; all four states/history unchanged. Do not count omitted events as version-stamped rating events.
   - margin-invariance: same states/outcome with different valid scores yields identical full expected rating outputs. League-metric-invariance pair changes only contextual standings/points, not any rating calculation input.
   - identical-played_at: two overlapping-player groups with deliberately reversed input order and distinct canonical UUIDs; assert chronological tie-break, intermediate states, final states and ordered event identities. Forward/reverse ingestion gives same approved replay.
   - provisional/self-declared equivalence: identical initial level/history produces identical outputs regardless of initialization source.
   - claim-invariance: provisional history followed by claim with unchanged user UUID; exact before/after state/history and event count equality; replay before/after claim yields identical outcomes.
   - first-creator-wins: first creator sets level, later creator proposes different level; original initialization and subsequent outputs persist. No extra rating event or reliability increment.

5. Derive explanations and close fairness review (AC4, AC5).
   - Write at least two player explanations for mixed-reliability fixture in same match. Cite case/player IDs and actual before-strengths, E, pre-reliability and applied delta; explain larger/smaller changes without invented PRD numbers.
   - Include Draw and clamped/rounded-zero explanation examples so wording does not promise gain where displayed level cannot increase.
   - State global skill is app-wide; match/League IDs are provenance only. No League position, League points, score margin or account-claim flag enters formula.
   - These are documentation examples, not component copy. No UI/a11y build required. Keep headings/table headers readable and do not convey direction solely by color. Explicitly hand explanation inputs/semantics to T10, which owns en/pt-BR/es UI localization; no locale catalog changes here.
   - Fairness table records concern, approved resolution, affected fixtures and human disposition. Resolve actual objections now; do not invent consent or schedule unresolved required fairness work as follow-up.

6. Independently verify every golden value and artifact contract (all ACs).
   - Authorized implementer computes expected values offline using high-precision decimal arithmetic, including high-precision base-10 exponentiation, and independently cross-checks using a separately written calculation path or independent reviewer. Do not generate both oracle and verification from one shared formula helper. No persistent verification code or dependency installation required.
   - QA checks all four players after every sequential operation, strengths/E, raw/applied deltas, half-cent ties, clamping, counts/reliability, event count/order, versions, unchanged state/history for exclusions/claim and equivalence pair assertions. Reviewer verifies explanation numbers against fixture IDs.
   - Parse JSON; validate required fields/types, unique case/player/group IDs where appropriate, valid timestamps, complete teams, coherent outcomes/scores and valid initial states. Cross-check fixture inventory and AC tags bidirectionally against spec.
   - Record method/tool versions, actual verification result and reviewer evidence inside specification. Do not fabricate pass results. Run repository-required pnpm complete-check through authorized QA before final delivery; warn that pnpm test/E2E reset shared local Supabase data. Report environment blockers precisely. Existing unrelated failures remain separate observations; no automatic issue creation or lowered thresholds.
   - No source tests or coverage claims: arithmetic/contract verification proves documentation/data correctness, not implemented engine behavior. T10 regression tests are its explicit existing scope, not unfinished PAF-9 work.

7. Obtain artifact-level HITL approval and hand off to T10.
   - Present exact spec + fixture revision/content hashes, fixture inventory, verification results, fairness resolutions and supporting operational choices for human review. Record actual approval evidence/reference through parent workflow. Parameter approval from intake remains attributed accurately.
   - Do not mark PAF-9 complete or unblock PAF-10 until both artifacts, resolved concerns and QA gate are approved. Any unresolved numerical interpretation goes to parent with affected AC/cases and required decision; required scope stays incomplete.
   - Handoff both paths and version tuple. Explain that T10 must consume expected values unchanged as regression oracle, implement config stamping, and preserve ordered/claim-invariant histories.
   - Elevated-risk mitigation: arithmetic or policy correction invalidates artifact approval and requires affected fixtures/explanations to be recomputed and re-reviewed. Preserve previously approved revision; change numerical contract under explicit version policy rather than silently rewriting approved config 1. No database rollback needed; no state mutation in this task.

## Validation

- Success criteria:
  - Exactly one normative spec and one machine-readable fixture file delivered; no product-code/test/config/schema changes and no coverage claim.
  - AC1 → steps 1–3, 6–7; proof: approved parameter/precision/replay table, version tuple, midpoint cases and explicit artifact approval record.
  - AC2 → steps 3–4, 6–7; proof: complete fixture inventory covering expected results/upset/Draw/reliability/first-group/boundaries, independently verified all-four-player snapshots.
  - AC3 → steps 2–4, 6; proof: exclusion cases preserve complete state/history and emit no events; score-margin pair produces identical rating results.
  - AC4 → steps 4–6; proof: fixture-linked explanation arithmetic and League-metric invariance; no League standings formula input.
  - AC5 → steps 2, 5–7; proof: explicit fairness disposition table, no open required concerns, no numerical requirements inferred from PRD illustrations, artifact-level approval before T10.
  - PAF-125 addendum → steps 2–4, 6–7; proof: self/creator initialization equivalence, immutable first estimate, unchanged identity/state/history through claim, identical replay.
- Checkpoints:
  - Before writing: step 1 source/approval reconciliation passes; missing prerequisites or contradictions surfaced with evidence and dependency/unblocking condition.
  - Before numbers: steps 2–3 numerical stages, delta semantics, status axes and fixture contract explicit; no hidden intermediate rounding or post-update reliability input.
  - Before human review: steps 4–6 every case parses and recomputes independently; explanation numbers and invariance assertions verified; actual repository QA result reported.
  - Final gate: step 7 approval references exact artifacts; all ACs mapped to proof; required unresolved work blocks completion. Optional/unrelated observations remain unscheduled.
