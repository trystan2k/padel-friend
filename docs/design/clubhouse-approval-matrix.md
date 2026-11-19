# Clubhouse approval matrix (U1 · coverage and scope reconciliation)

> **Decision log (2026-11-19):** all decisions D1–D9 answered by the issue owner on 2026-11-19. D1 surfaces are **blocked pending new frames** (status `blocked (frame pending)`); all other areas are unblocked. Route/status rows below reflect the owner decisions; section 2 counts are the U1 baseline census taken before the decisions.

Analysis artifact only. No product code, tokens or styles changed. Decisions D1–D9 in the "Decision packet" are answered by the issue owner (see each "OWNER DECISION" line). Canonical design: `docs/design/padel-friend-clubhouse.pen` (top-level node census read through the Pencil MCP, never as text). Legacy `docs/design/padel-friend.pen` is migration-only. The copy under `docs/design/Padel-friend App Redesign/padel-friend-clubhouse.pen` is NOT canonical.

## 1. Methodology

1. Route census: every file under `src/routes` (49 at base `f78d006`) opened for `createFileRoute` target, guards (`beforeLoad`), `component`, and rendered feature component. Route roots are NOT treated as pages: layouts, outlets, redirects and endpoints are classified separately; hybrids (page + outlet) are noted.
2. Design census: 129 top-level Pencil nodes enumerated with ID, type, name, reusable flag and bounds. Composites (`OkNwP`, `cnU76`) and reusable state boards (`n6zFq`, `ausNa`, `x2GG9U`, `JXjNs`, `MYsDp`, `tzBrY`, `r9r34`) were expanded one to three levels to list nested state frames. Text content of conflict frames was read to detect behavior claims.
3. Mapping: Linear seed frame IDs per unit were used as candidates, then confirmed against route component, frame name and frame text. A frame ID is only a candidate until the owner approves it (plan rule).
4. Precedence rule: route-specific frame beats generic frame for that state; generic frames only supply shared conventions. When two frames both claim a route/state and neither is clearly route-specific, status = `conflicting` and goes to the decision packet instead of being picked silently.
5. Data verification: each design promise that shows data (counts, deltas, countdowns, filters, rankings, teams) was traced to an existing server function, RPC, contract type or locale string. Not found = flagged "no source" (never fabricate).
6. Offline verification: code (`navigator.onLine` / `isOffline()` guards in 19+ feature files), locale strings (`Offline. Nothing sent. Reconnect and try again.` family) and `e2e/offline-mutations.spec.ts`.
7. Sibling pattern PAF-201: `e2e/references/paf-201/manifest.json` records source path, frame IDs, export scale, comparison and per-frame allowance. Every later unit should follow it. Note it pins the legacy `.pen` path today; U24 migrates.

Status vocabulary: `mapped` (exact route-specific frame(s) found) · `mapped*` (frame found, but with a data/behavior caveat listed in section 4) · `partial` (frame covers only part of the route states) · `unmatched` (no frame) · `conflicting` (contradictory candidates or contradicts app behavior) · `n/a` (layout/redirect/endpoint, behavior or inherited chrome only).

## 2. Inventory summary

| Metric | Count |
| --- | ---: |
| Route files in `src/routes` | 49 |
| Pure layout / outlet / guard shells | 7 (`__root`, `_protected`, `_protected.matches`, `_protected.notifications`, `_protected.platform-admin`, `_protected.community.$communityId.admin` (nav shell), `…admin.members` (outlet)) |
| Of the visual pages, hybrid page + outlet | 1 (`_protected.matches.$eventId`, counted as a page) |
| Redirect-only | 1 (`…admin.index` → `/community/$communityId/admin/requests`) |
| Endpoint / callback (no UI) | 1 (`auth.callback.ts`) |
| Visual page routes (incl. 1 hybrid) | 40 |
| Top-level Pencil nodes | 129 |
| Top-level nodes assigned to a unit or state (seed list) | 117 |
| Top-level nodes with no unit (annotation / section / logo) | 12 (see section 5) |
| Nested state frames identified in composites | 28 (`OkNwP` 10 · `cnU76` 18) |
| Route status: mapped | 18 |
| Route status: mapped* (caveat in section 4) | 11 |
| Route status: partial | 4 (`onboarding`, `…record`, both platform level-review routes, which are also flagged conflicting in D7) |
| Route status: unmatched | 5 (`privacy`, `auth.confirm-invite`, `…leagues.index`, `…level-reviews.index`, `…notifications.$notificationId`) |
| Route status: conflicting | 2 (`forgot-password` via `FZlHy`, `onboarding_.community` via `Qstxv`/`dSEX3`); `JLqMT` on `…matches.$eventId` is conflicting at state level |
| Route status: n/a (layout/redirect/endpoint) | 9 |
| Design-only compositions with no route file | 2 (Community overview/ranking, Me) |

(Status counts are over the 49 route files: 18 + 11 + 4 + 5 + 2 + 9 = 49. The two no-route rows in section 3 are extra and not counted.)

## 3. Route inventory and route → frame mapping

Columns: route file stem (under `src/routes`, `.tsx` unless noted) · URL · rendered component(s) · class · canonical frame(s) · precedence / notes · status · unit.

### Public and auth (U4 shell · U6 · U7 · U8 · U23)

| Route | URL | Component | Class | Frame(s) | Precedence / notes | Status | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `__root` | all | Root document, fonts, locale/theme, PWA registration, skip link | layout | none (inherited chrome) | Floating locale/theme controls are NOT drawn in frames; `ju6S4` records them as a reserved 44×44 inset | n/a | U2/U4 |
| `index` | `/` | PublicHomepage | page | `xhsTX` light · `K5DgRu` dark · `QtxDQ` signed-in · `DHZoj` es · `HkMpo` pt-BR · `UuaXy` 320 es · annotations `N6wce` (signed-in CTA swap) · `ju6S4` (control inset) | Route-specific; annotations are exceptions, not frames. Existing homepage renders an inline SVG tile, not the mandated PNG (see D8) | mapped | U23 (U4 for annotation treatment) |
| `privacy` | `/privacy` | PrivacyPolicy | page | none | Linked from homepage footer (`privacyLink`) and auth | blocked (frame pending) — D1 | U23 |
| `login` | `/login` | LoginWelcome | page (redirect when authed) | `wzWLt` | `FZlHy` ("Login — check your inbox") is title-ambiguous: could be forgot-password sent state, see D7 | mapped* | U6 |
| `onboarding_.account` | `/onboarding/account` | AccountSignup | page | `EGb2g` | Route-specific | mapped | U6 |
| `forgot-password` | `/forgot-password` | ForgotPassword (+ sent state) | page | `ieoni` form · `FZlHy` sent/inbox (candidate) | Candidate until owner confirms `FZlHy` is the forgot-password success state | mapped (D7: `FZlHy` = forgot-password sent state) | U6 |
| `reset-password` | `/reset-password` | ResetPassword | page | `ZthyR` | Route-specific | mapped | U6 |
| `auth.confirm-invite` | `/auth/confirm-invite` | InviteConfirmation | page | none | Provisional-invite confirmation after email link | blocked (frame pending) — D1 | U6 |
| `auth.callback.ts` | `/auth/callback` | none (GET handler) | endpoint | none | Behavior only; PKCE/session cookies, return path | n/a | U6 |
| `onboarding` | `/onboarding` | PlayerOnboarding · ClaimPasswordStep · ProvisionalClaimVerify | page (multi-state) | `PdRtP` setup · nested `cnU76`→`cs78ezj` claim prefilled · `ct4tab0` claim level locked | Claim onboarding IS covered; ClaimPasswordStep and ProvisionalClaimVerify have NO frame (not equivalent to onboarding frames) | partial; ClaimPasswordStep + ProvisionalClaimVerify: blocked (frame pending) — D1 | U7 |
| `onboarding_.community` | `/onboarding/community` | CommunityOnboarding · CommunityInbox · InvitationDiscoverability · InviteeSearch | page (multi-state) | `dSEX3` discovery · `JO4DC` create · `iyZrO` invite accept · `MrHkt` pending approval · `ah9u1` denied/expired | `Qstxv` ("Discover communities", Community-tab flow) also targets this surface: route-specific `dSEX3` wins for `/onboarding/community`; `Qstxv` has no other route (D7) | mapped (D7: `Qstxv` = community onboarding, `dSEX3` = discovery) | U8 |

### Protected shell and Home (U4 · U5)

| Route | URL | Component | Class | Frame(s) | Precedence / notes | Status | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `_protected` | guard | ProtectedLayout (auth + onboarding guard, identity guard) | layout/guard | none | Behavior preserved; also the reason `JLqMT` cannot be public (D3) | n/a | U4 |
| `_protected.dashboard` | `/dashboard` | Dashboard → HomeDashboard, PlayerProfile, CommunityAdminEntries, LeagueEntries, PlatformAdminEntry, CommunityInbox, InvitationDiscoverability, CommunitySwitcher | page | `hKncV` light · `AlfRD` dark · `OdU52` community switcher | Route-specific. Frames omit profile/admin/league entry points: they must be relocated (D5). `HomeNavigation` today is 5 anchors/links (home, matches, community, ranking, profile) vs design 4 tabs + central Create | mapped* | U5 |

### Matches (U11 · U12 · U13 · U14 · U15 · U16)

| Route | URL | Component | Class | Frame(s) | Precedence / notes | Status | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `_protected.matches` | `/matches` | Outlet | layout | none | Nav destination owner = U4 | n/a | U4 |
| `_protected.matches.index` | `/matches` | MatchesPage (available) | page | `ENn8Q` list · `kYI9H` empty | Filter chips drawn have no contract (D6) | mapped* | U11 |
| `_protected.matches.my` | `/matches/my` | MatchesPage (my) | page | `uePpj` | Route-specific | mapped | U11 |
| `_protected.matches.past` | `/matches/past` | MatchesPage + MatchHistory | page | `w25dY` | `BcpYH` is "Match history detail" (group detail), not the list | mapped | U11 |
| `_protected.matches.create` | `/matches/create` | CreateMatchPage (4 steps, state not URL) | page | `wHaAb` details · `vAxZh` players · `b5RR4` teams · `RDV2r` review | Step is component state; `b5RR4` pair selectors have no stored fields (D6) | mapped* | U13 |
| `_protected.matches.$eventId` | `/matches/$eventId` | MatchDetailPage, RegistrationPanel, ParticipantActions, RosterCard, InvitationPanel, RequestQueue, StatusBanner, organizer/result panels; Outlet when child route active | page + outlet (hybrid) | `eYIgj` friendly · `nNzWb` competitive unranked · `fo8Zn` direct join · `SYMLa` full · `tYXlh` closed · `t1ywa` participation variants · `Cpd7L` quartet filled · `xC04T` roster states · `Fyhbv` invited · `CLn9x` requests organizer · `Za6r4` requester states · `JLqMT` public guest | `JLqMT` contradicts protected access (D3). `OkNwP` nested: invitation Accepted `c27ucrt` / Declined `c37x0cg` / Expired `c4aviyi`, creator action menu `c5xzgnc`, organizer-only `c7o7c5e`, Cancelled `c8dcjv8`, minor edit conflict `c9n78kb`, reconfirmation summary `cb5peff`, started unavailable `ccicygl`, results protected `cdqb0a4`. Top-level management frames: `lJHUZ` minor edit · `t0SZec` major change · `oVtuS` reconfirmation · `uiRqp` cutoff excluded · `q2TCnQ` remove · `Ht2Oq` cancel · `m7hh3` withdraw/transfer · `dmvWu` unavailable. Add-player (`cnU76`) states: dialog empty/filled/errors/submitting/light, rate limited, invitation failed, offline, cutoff passed, owner entries (menu, roster header), success playing/reserve. Result states on this page: `sLXK7` approve · `alZmm` pending · `iXRPp` started unavailable + record entry · `JXjNs` pending/auto-confirm board · `CWJkF` dispute · `H6VcqC` reject dialog · `GMcbD` partial resolution · `adujr` amendment request · `s5TRC` corrected review | mapped* (D3: `JLqMT` visuals for authorized states only) | U12/U14/U16 |
| `_protected.matches.$eventId.record` | `/matches/$eventId/record` | RecordMatchResultPage | page | Route-specific wins: `XySt5` score · `GPo9z` review win · `c0wbmu` review incomplete · `NZk5H` review friendly · `wsXWA` invalid set. Generic (conventions only): `lKv9B` full page · `Hzcid` WIN preview · `BnwEB` INCOMPLETE · `u78yF` friendly no-effect · `LD9Jv` per-set error | `Route ·` frames are 188–204px tall (fragments), generic `lKv9B` is full 844px: confirm fragments only replace the region they show (D7) | partial (D7: route-specific fragments win over `lKv9B`) | U15 |
| `_protected.matches.$eventId.groups.$groupId` | `/matches/$eventId/groups/$groupId` | ConfirmedGroupDetail | page | `BcpYH` (D7: confirmed group detail) | Name match only ("Match history detail"); confirm | mapped* | U20 |

### Community (U8 · U9 · U10 · U17 · U20 · U22)

| Route | URL | Component | Class | Frame(s) | Precedence / notes | Status | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (none) | no `/community/$communityId` index | n/a | missing route | `Ex7RD` community home · `y4Zeg` skill ranking | No route for overview or ranking exists today (D4) | new routes from existing data only (D4); no-source data → unavailable state (D6) | U9 |
| `…community.$communityId.admin` | `/community/$communityId/admin` | AdminLayout / CommunityAdminShell | layout (nav) | none | Admin nav not drawn as a separate frame | n/a | U10 |
| `…admin.index` | `/community/$communityId/admin` | none | redirect → `…/admin/requests` | none | Behavior only | n/a | U10 |
| `…admin.members` | `…/admin/members` | Outlet | layout | none | | n/a | U10 |
| `…admin.members.index` | `…/admin/members` | CommunityAdminViews members | page | `wFqGR` | Route-specific | mapped | U10 |
| `…admin.members.$membershipId` | `…/admin/members/$membershipId` | member detail/actions | page | `jQDkx` | Route-specific | mapped | U10 |
| `…admin.requests` | `…/admin/requests` | access requests | page | `RgqPq` | Route-specific | mapped | U10 |
| `…admin.settings` | `…/admin/settings` | settings form | page | `N18Mu4` | Route-specific | mapped | U10 |
| `…admin.venues` | `…/admin/venues` | saved venues + VenuePhotoUpload | page | `A5Vio` | Photo upload state not drawn | mapped | U10 |
| `…admin.audit` | `…/admin/audit` | audit log | page | `E5CS5K` | Route-specific | mapped | U10 |
| `…leagues.index` | `/community/$communityId/leagues` | LeagueListPage | page | none dedicated; `x2GG9U` "No active league" is an empty-state candidate only | List with active/closed leagues has no frame | blocked (frame pending) — D1 | U17 |
| `…leagues.create` | `…/leagues/create` | CreateLeaguePage | page | `ik5JC` · validation variants `MYsDp` | Route-specific | mapped | U17 |
| `…leagues.$leagueId` | `…/leagues/$leagueId` | LeagueDetailPage, Standings, StandingsHistory | page | `ywfn7` active · `d6ANDN` end confirmation · `xbIxj` history/audited correction · `r9r34` former participant access | Route-specific states | mapped | U17 |
| `…community.$communityId.statistics` | `…/statistics` | CommunityStatistics | page | `o9iaC1` · filters `m8Loju` | Design shows "Avg. level", "Most active venue", "Competitive share" with no source (D6) | mapped* | U20 |
| `…community.$communityId.repairs` | `…/repairs` | ResultRepairDiagnostics (community scope) | page | `bomAY` desktop light · `SluH3` desktop dark · `cuVwp` mobile light · `Jjrtb` mobile dark | Frames are "Platform Admin"; one family serves both scopes: confirm (D7) | mapped* | U22 |

### Me, level reviews, statistics, platform admin (U18 · U19 · U20 · U22)

| Route | URL | Component | Class | Frame(s) | Precedence / notes | Status | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (none) | no Me route | PlayerProfile hosted in `/dashboard` | missing route | `vARtQ` player profile · `x2GG9U` empties | No dedicated self/profile route (D5). Profile edit, AvatarUpload, AvailabilityFields, RatingJourney/chart have no frames | new route `/me` (D5, shell from U4, completed in U18); profile edit + chart details: blocked (frame pending) — D1 | U18 |
| `…players.$playerId.index` | `/players/$playerId` | PlayerStatistics, PartnerRecords, OpponentRecords, MatchHistory | page (statistics, NOT self-edit) | `RN0yw` · `RRuhH` form/breakdown · `z6vIR` advanced outcomes · `QVLTH` partnership records · `m8Loju` filters | `vARtQ` "Statistics ›" row links here | mapped* | U20 |
| `…players.$playerId.partners.$partnerId` | `…/partners/$partnerId` | PairStatistics | page | `GrkSH` | Route-specific | mapped | U20 |
| `…players.$playerId.opponents.$opponentId` | `…/opponents/$opponentId` | OpponentStatistics | page | `khmeK` | Route-specific | mapped | U20 |
| `…level-reviews.index` | `/level-reviews` | PlayerLevelReviewHistory | page | none | `OKYtp` is one request's status | blocked (frame pending) — D1 | U19 |
| `…level-reviews.new` | `/level-reviews/new` | PlayerLevelReviewRequest | page | `qWosG` | Single-level field vs min/max range in code (D6) | mapped* | U19 |
| `…level-reviews.$requestId` | `/level-reviews/$requestId` | PlayerLevelReviewStatus | page | `OKYtp` | "Request #LR-2048", "Usually 2–3 days" no source (D6); withdraw ≈ `cancel_level_review_request` exists | mapped* | U19 |
| `_protected.platform-admin` | guard | Outlet + access guard | layout | none | | n/a | U4/U19 |
| `…platform-admin.level-reviews.index` | `/platform-admin/level-reviews` | PlatformLevelReviewQueue | page | `gGNxk` (partial: Pending·3/Decided header + one request card) | Single frame serves queue AND detail; no separate queue vs detail frames | blocked (frame pending) — D1 (D7: `gGNxk` serves queue and detail until new frames land) | U19 |
| `…platform-admin.level-reviews.$requestId` | `…/level-reviews/$requestId` | PlatformLevelReviewDetail | page | `gGNxk` (decision note, Approve/Reject) | Same frame as queue | blocked (frame pending) — D1 (D7: `gGNxk` serves queue and detail until new frames land) | U19 |
| `…platform-admin.result-repairs` | `/platform-admin/result-repairs` | ResultRepairDiagnostics (platform scope) | page | `bomAY` `SluH3` `cuVwp` `Jjrtb` | Route-specific | mapped | U22 |

### Notifications (U21)

| Route | URL | Component | Class | Frame(s) | Precedence / notes | Status | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `_protected.notifications` | `/notifications` | Outlet | layout | none | | n/a | U4 |
| `_protected.notifications.index` | `/notifications` | NotificationsPage | page | `cAqsQ` list · `Z0gRd` registration and cutoff · `qNVpA` quartet and playing | Z0gRd/qNVpA are notification type variants of the same list | mapped | U21 |
| `_protected.notifications.$notificationId` | `/notifications/$notificationId` | NotificationDetailPage (+ invitation accept, result and level-review outcomes) | page | none | | blocked (frame pending) — D1 | U21 |
| `_protected.notifications.preferences` | `/notifications/preferences` | NotificationPreferencesPage, PushDevicePanel, PwaInstallPanel | page | `y8ErQ` preferences · `nRn4M` Web Push setup · `tzBrY` PWA install/failure states | Route-specific | mapped | U21 |

### Shared system frames (U2 · U3)

| Frame | Scope | Consumers | Status |
| --- | --- | --- | --- |
| `c1TsP` Design tokens (full inventory) | tokens, both themes | all | mapped (U2) |
| `Ilxwe` text input · `B3Uqv` button · `QFH5u` text link · `RMese` card | reusable primitives | all | mapped (U3) |
| `n6zFq` loading/empty/error/offline/access · `ausNa` conflicts and offline writes · `x2GG9U` empties · `JXjNs` pending/auto-confirm · `MYsDp` league validation · `tzBrY` PWA states · `r9r34` former participant | shared state boards | U3 primitives + page units | mapped* (offline wording conflicts, D2) |

## 4. Decision packet (all answered by owner, 2026-11-19)

Each decision lists the original question, options, and implementation impact, followed by the recorded OWNER DECISION.

### D1 — Missing dedicated surfaces

**OWNER DECISION (2026-11-19):** The 10 frame-less surfaces (privacy policy, notification detail, level-review history, platform level-review queue + detail, auth invite confirmation, claim password step, provisional claim verify step, league index, profile edit + chart details) will receive NEW frames designed by the owner via a Pencil agent. Until those frames are approved and land in the pen file, these surfaces are BLOCKED (`blocked (frame pending)`): keep today's layout, restyle only through shared primitives/tokens (U2–U3 spillover), never improvise structure. Ready-to-use prompt: section 9, "Pencil agent prompt — missing frames (for owner)".

**Evidence.** No frame for: `/privacy` (PrivacyPolicy), `/notifications/$notificationId` (NotificationDetailPage), `/level-reviews` history, platform level-review queue vs detail (only `gGNxk`, partial), `/auth/confirm-invite`, claim password step (ClaimPasswordStep) and claim verification (ProvisionalClaimVerify) — claim *onboarding* `cs78ezj`/`ct4tab0` is covered and not equivalent, league index (`…/leagues` list), profile edit (PlayerProfile edit mode, AvatarUpload, AvailabilityFields), rating journey / progress chart / history / explanation, and any statistics chart beyond `RN0yw`/`o9iaC1`.

**Question.** For each listed surface, which treatment is approved: (a) a new approved Pencil frame, (b) explicit reuse/adaptation of a named existing frame, (c) an explicit scoped exception that keeps today's layout with only inherited token/typography changes, or (d) leave blocked?

**Options and impact.**
- (a) New frame: unit waits for the frame; then normal frame-faithful implementation and probe/visual proof. Highest fidelity, schedule risk to U6, U7, U14, U17–U21, U23.
- (b) Reuse/adapt (e.g. `/level-reviews` history rows styled like `gGNxk` cards; `/privacy` using public-homepage typography; league index using `x2GG9U` empty + `ywfn7` card): named frame ID recorded per unit, adaptation documented, visual budget justified as derived (not exact) evidence.
- (c) Exception: no layout restyle; only shared foundation (font, tokens, controls) applies; U24 records an approved deviation instead of a frame. Lowest effort; surface may look inconsistent next to Clubhouse pages.
- (d) Blocked: unit cannot complete AC; U24 cannot certify; per plan only an approved scope revision permits partial delivery.

### D2 — Offline behavior (copy truthfulness)

**OWNER DECISION (2026-11-19):** Truthful offline copy. Frames `n6zFq`/`ausNa` wording about queued offline writes is NOT implemented; use truthful copy (offline writes are rejected; nothing queued/sent) in en/pt-BR/es. No behavior change.

**Evidence.** `ausNa` shows "Saved offline · 2 changes waiting — They send automatically when you reconnect." and `n6zFq` shows "Offline · showing saved data. Changes send when you reconnect." The app rejects offline writes everywhere (`navigator.onLine` / `isOffline()` in matches, leagues, community, level reviews, result repairs, notifications); copy such as "Offline. Nothing sent. Reconnect and try again." exists in en/es/pt-BR; `e2e/offline-mutations.spec.ts` asserts disabled actions, "nothing sent" copy and that reconnect never replays a command. No write queue exists.

**Question.** Do you approve rendering the offline/conflict state frames with truthful blocking-and-retry wording (nothing queued, nothing sent) instead of the drawn "waiting / sends automatically" wording? Or do you want a real offline write queue (new scope)?

**Options and impact.**
- A (recommended): Keep existing rejection semantics; reuse `n6zFq`/`ausNa` visuals with truthful copy ("Offline. Nothing sent. Reconnect and try again."), drop the "2 changes waiting" card. Impact: U3 notice component + copy en/pt-BR/es; consumers U14, U16, U21 (and every offline-aware feature) pick up the same notice; no backend change.
- B: Offline queue with deferred replay. Impact: new service worker/queue design, idempotency, conflict handling, auth/RLS and security review; contradicts the current "never replays" test; out of epic scope (no queue changes authorized); would block U3/U14/U16/U21 until a separate design.
- C: Hide the offline-queued card and use only `n6zFq`'s "showing saved data" variant with the sentence trimmed to a truthful form. Impact: same as A minus the dedicated notice shape.

### D3 — "Public guest" frame (`JLqMT`)

**OWNER DECISION (2026-11-19):** Frame `JLqMT` visuals are reused for AUTHORIZED match-detail states only. No anonymous access, no onboarding bypass, no auth/RLS changes.

**Evidence.** `JLqMT` is titled "Match detail — public guest" and shows "Members only · you'd join as reserve #3 / Join Northside to play". Route `_protected.matches.$eventId` sits under `_protected`, which redirects unauthenticated users to `/login` and not-onboarded users to `/onboarding`. No public match route exists.

**Question.** How should `JLqMT` be used: reuse its visual language for authorized states only (member, non-member of the community, reserve) with no public/anonymous access, or do you approve a scope revision that makes some match detail public?

**Options and impact.**
- A (recommended): Faithful visual reuse for authorized states only; `/matches/$eventId` stays protected; the "Members only / Join" copy renders for signed-in non-members using existing registration/access state. Impact: U12 (and U14–U16 by dependency); U4 unchanged.
- B: Treat `JLqMT` as a record-only frame (no implementation) and rely on `eYIgj`/`nNzWb`. Impact: U12 still maps all other states; no non-member card until another reference is approved.
- C: Public/anonymous match detail. Impact: new unauthenticated route or guard change, RLS/data-exposure review, SEO/cache policy, redirect and onboarding changes. Not authorized by the epic; would stop U4 and U12 until separately specified.

### D4 — Community overview / ranking composition (`Ex7RD`, `y4Zeg`)

**OWNER DECISION (2026-11-19):** Community overview + ranking (`Ex7RD`/`y4Zeg`): create NEW routes composed from EXISTING data only (league standings, own rank). No backend additions. Data without a source renders a truthful unavailable state per D6.

**Evidence.** Frames show Overview / Ranking / Leagues segments under a community header, "18 active this week", "3 people want to join", a six-row skill list with names, levels and "↑1 place" movement, plus Skill/League toggle. Code today: no overview or ranking route; Home already contains `HomeRanking` (own skill position, `rankedMembers`, movement, and top league rows); league standings via `get_league_standings`; community statistics via `get_community_statistics`; `activePlayers` there is "distinct confirmed participants in the window, not the member count"; no RPC lists all members' skill levels; pending-request counts are an admin-only read. `HomeNavigation` currently exposes a `ranking` anchor.

**Question.** Where does Community overview and Ranking live, and what data may it show?

**Options and impact.**
- A: Create `/community/$communityId` (overview) plus a ranking tab/route; ranking shows only fields with existing sources (own rank/position, `rankedMembers`, movement from `HomeRankMovement`, league standings rows); all other rows/fields render a truthful unavailable state. Impact: new route files (explicit approval needed), U4 nav destination, U5 links, U9, U17 (Leagues segment). No backend.
- B: Compose overview/ranking inside existing surfaces (Home ranking section + leagues + community statistics) without a new route; `Ex7RD`/`y4Zeg` become visual guidance only. Impact: smaller change; Community tab target must be an existing route (e.g. leagues index or statistics); U9 collapses into U5/U17.
- C: Approve a new backend read for a member skill list (new RPC, privacy and RLS review). Impact: out of epic scope; stops U9 until authorized.
- D: Defer overview/ranking (record-only). Impact: U9 closed as not applicable; nav Community destination must still be defined (see D5/D9).

### D5 — Me / profile composition (`vARtQ`, `x2GG9U`) and handoff order

**OWNER DECISION (2026-11-19):** Me gets a NEW dedicated route (repo-convention path, e.g. `/me`) composing existing profile/settings surfaces; `/players/$playerId` keeps its statistics role. The route must exist from U4 (shell) onward so the Me tab never dead-ends; rating journey refinement happens in U18. Order: U4 creates the route shell composing existing surfaces, U18 completes it.

**Evidence.** `/players/$playerId` is the statistics page (also supports own-player view). Full PlayerProfile (avatar upload, availability, theme, language, sign-out, links) is hosted on `/dashboard`. Design Me has stats card (matches, W–L–D, win rate), level 3.82 + reliability, "↑ 0.31 this season", Statistics / Match history / Level review / Notifications rows, Appearance toggle, and empties. No profile-edit or chart frame exists.

**Question.** What is the Me destination: (a) a new Me route that hosts the profile, (b) the existing `/players/$playerId` page extended with a self header, (c) keep profile on `/dashboard` and style it in place? Which edit/chart treatment (D1) applies, and in what order do U4/U5/U18 hand off so no link is dead?

**Options and impact.**
- A: New Me route (self profile + settings + links). Impact: new route file (approval), U4 nav target, U5 removes the full profile/admin dump with links, U18 composition, U19 and notification links; keep old deep links.
- B: Extend `/players/$playerId` for self. Impact: no new route, but conflates statistics and settings; `isOwn` branch exists; U18 and U20 share a surface; plan says do not take over statistics unless explicitly approved.
- C: Profile stays on dashboard. Impact: contradicts "no full profile under Home"; Home composition (`hKncV`) cannot be met; U5/U18 criteria would need revision.
- Handoff rule needed: U4 may point Me at the existing destination until U18 lands; orphaned actions are not allowed even temporarily.

### D6 — Data-source verification (do not fabricate)

**OWNER DECISION (2026-11-19):** Policy per item: derive the metric from a named existing field where possible (auto-confirm countdown label from the stored deadline); otherwise render a truthful "unavailable" state. Never fabricate numbers. No backend changes.

See section 6 for source evidence per promise. **Question.** For each design promise with no existing source, approve one of: (a) truthful unavailable/hidden state, (b) a real existing lever (named field), or (c) a new backend field (out of scope unless explicitly authorized). Items needing a ruling:

1. Home "↑ 0.08" next to level (no defined period) · "4 matches to 100%" reliability hint · Me "↑ 0.31 this season" (no season delta source).
2. Community "18 active this week", "3 people want to join" (admin-only count), "Madrid" and "Public" (available: `city_label`, `visibility`).
3. Available-matches filter chips "This week / Competitive / Friendly / My level" (`list_match_events` takes no filter arguments).
4. Create match "Predefined teams — Pair 1 / Pair 2 / Open spot" selectors (only `team_assignment_mode` radios exist; no pair fields).
5. Level review: single level "4.1" (code stores min/max range), "#LR-2048" request id, "Usually 2–3 days", "Member 2024 · 18 competitive games" on the admin card.
6. Community statistics "Avg. level", "Most active venue", "Competitive share" (matches.competitive/played exist; no level or venue aggregate in the contract).
7. Result "Auto-confirms in 18h" (deadline exists in result model; a relative label is derivable, not a live ticking countdown unless approved).

**Impact.** (a) Cheapest and consistent with the epic rule; frame regions with no data become explicit "unavailable"/omitted and probes assert that. (b) Requires per-field source proof recorded on the unit. (c) Stops the unit until authorized.

### D7 — Contradictory or partial candidates

**OWNER DECISION (2026-11-19):** Confirmed. Route-specific frames always take precedence over generic ones, and the candidate mappings are adopted: `Qstxv` = community onboarding, `dSEX3` = discovery; `FZlHy` = forgot-password sent state; `CWJkF` = record-only (no route); `gGNxk` serves both platform queue and detail; route-specific result fragments beat generic `lKv9B` where they exist; `BcpYH` = group detail; diagnostics frames serve both community and platform families; top-level management frames beat `OkNwP` composite children where both match.

**Question.** Confirm the intended frame for each:
1. `Qstxv` vs `dSEX3` for `/onboarding/community` (and is a post-onboarding Discover destination in the Community tab approved, which no route provides?).
2. `FZlHy` ("Login — check your inbox"): is it the forgot-password sent state, or a sign-in magic-link state that does not exist?
3. `CWJkF` ("Community dispute resolution"): no route renders admin dispute resolution; is it in scope (which surface hosts it) or record-only?
4. `gGNxk`: one frame for both platform level-review queue and detail — approve as queue-only, detail-only, or a new second frame?
5. Record-result `Route ·` fragments (188–204px) vs generic `lKv9B`: confirm fragments replace only their regions and `lKv9B` remains the full-page frame.
6. `BcpYH` ("Match history detail") = `/matches/$eventId/groups/$groupId`?
7. Repair diagnostics frames are titled "Platform Admin"; approve the same family for the community scope route.
8. Duplication between top-level `lJHUZ`/`t0SZec`/… and the same-purpose children inside `OkNwP`: which wins when they differ (rule: route-specific over composite, escalate otherwise).

### D8 — Logo and icon slots (epic AC2)

**OWNER DECISION (2026-11-19):** Derive variants. All in-app logo usages reference `docs/design/padel-friends-app-icon.png`; maskable/apple-touch/manifest variants are generated FROM that file (padding/sizing only — artwork never recreated).

**Evidence.** Mandatory source `docs/design/padel-friends-app-icon.png` (1254×1254 RGBA, sha1 `2d71cb9b…`). Slots found: `public/icon.svg` (manifest `any`), `public/icons/icon-192.png`, `icon-512.png` (RGBA, `any`), `maskable-192.png`, `maskable-512.png` (RGB, purpose `maskable`), `apple-touch-icon.png` (180, RGB) via `__root.tsx`, no `rel=icon` link in `__root.tsx`; public homepage draws an inline SVG icon tile (`PublicHomepage.tsx`), login shows a text brand only; Pencil frames `R7ZBi1` (favicon 64) and `UW2iX` (PWA 512) and exports `docs/design/icon-exports/favicon.png`, `pwa-icon-512.png`.

**Question.** Which slots must literally contain the supplied PNG (visible logo instances only, or also manifest/apple-touch/favicon), and how are maskable/opaque-background requirements treated if the exact PNG cannot satisfy install safe-zone rules?

**Options and impact.**
- A: Visible logo instances use the PNG as-is; install slots (maskable, apple-touch) keep current derived assets with a recorded exception. Impact: U4/U6/U23 reference the PNG; no re-export; U23/U24 prove path/byte lineage for visible instances.
- B: All slots must be the exact file/crops from the supplied PNG, including maskable. Impact: if exact use breaks maskable safe zone/opacity, the owner must explicitly accept the visual result; no re-export or substitution by the agent.
- C: Use the existing `docs/design/icon-exports/*` as approved lineage. Impact: requires owner to confirm those are derived from the supplied PNG and acceptable.

### D9 — Navigation and theme/viewport coverage

**OWNER DECISION (2026-11-19):** Confirmed all three: (1) 5 destinations Home/Matches/Create/Community/Me, no sixth Ranking tab — Ranking is reached inside Community; (2) pages without drawn dark/wide frames derive those variants from tokens; (3) wizard/overlay/nested screens suppress bottom nav + show sticky actions per the matrix rules.

**Question.** Confirm (a) bottom nav = Home / Matches / Create (central) / Community / Me (5 items, no sixth Ranking tab) and where Ranking is reached, (b) that dark-mode and wide/desktop variants for pages without dark/wide frames are derived from tokens (only `AlfRD`, public homepage dark and repair diagnostics dark/desktop are drawn), and (c) the sticky-action vs nav suppression rule for the Create wizard, overlays and nested screens.

**Impact.** (a) drives U4 link table and U9/U18 handoff; (b) means visual proof for other pages is structural probes + Chromium baselines rather than Pencil dark exports; (c) affects every sticky-action page.

## 5. Pencil frames with no corresponding app page (record-only, not scope)

Top-level nodes not assigned to a unit/state:

| ID | Name | Nature |
| --- | --- | --- |
| `bi8Au` | Padel Friends — visual direction | design title board |
| `R7ZBi1` | Favicon — 64 px | logo slot (D8) |
| `UW2iX` | PWA icon — 512 px | logo slot (D8) |
| `W1xIkQ` · `S9CktA` · `tCmpB` · `RhtqB` · `RNhC3` · `lBL0P` · `V8pq0d` · `R3H8j` · `CxTAV` | Flow headers (sign-in & onboarding, explore & join, create & manage, results, community, leagues, player profiles, notifications & PWA, design reference library) | section labels |

Design-only or no-route state frames (implementation blocked or record-only until a decision):
- `Ex7RD`, `y4Zeg` — no Community overview/ranking route (D4).
- `vARtQ` composition — no Me route (D5).
- `CWJkF` — no dispute-resolution route (D7).
- `Qstxv` — second discovery destination beyond onboarding (D7).
- `JLqMT` — public access not available (D3).
- `FZlHy` — ambiguous destination (D7).
- Nested design references that are not app pages: `ctemg3x` Invitation email (email template reference), `cvdbizc` Dialog interaction notes, `cuhgc7v` Provisional player — other places (no matching surface found; confirm).

## 6. Data-source verification results

| Design promise (frame) | Existing source found | Result |
| --- | --- | --- |
| Level + reliability (`hKncV`, `vARtQ`) | `display_level`, `reliability_percent` (profile, rating summary) | available |
| "of 86" ranked members (`hKncV`) | `HomeSkillRank.rankedMembers` | available |
| Own rank movement "↑2 places" (`y4Zeg`) | `HomeRankMovement` (up/down places, same, new) from rank history | available for self only |
| Level change "↑ 0.08" (`hKncV`) | `HomeActivity.rating.delta` per rating event; period not defined | ambiguous (D6) |
| "↑ 0.31 this season" (`vARtQ`) | rating history `applied_delta` per entry; no season concept found | no direct source (D6) |
| "4 matches to 100%" (`hKncV`) | none found | no source |
| Full community skill list with names, levels, movement (`y4Zeg`) | none; only own position and league standings (`get_league_standings`), `get_player_statistics_rank_history` | no source (D4) |
| "18 active this week" (`Ex7RD`) | `activePlayers` in community statistics is window-based (not a fixed weekly count) | derivable only with filter window; confirm (D6) |
| Member count, city, public (`Ex7RD`) | `member_count` (onboarding list), `city_label`, `visibility` | available |
| "3 people want to join" (`Ex7RD`) | community access-request list is admin-only; `HomeAction` count covers match registrations | no member-visible source |
| Next match, attention list (`hKncV`) | `HomeData.matches.next`, `HomeData.actions` | available |
| Notification unread badge | `HomeData.unread` | available |
| Available matches filters (`ENn8Q`) | `list_match_events` args: community, cursor, entry, limit, as_of; no filter UI in MatchesPage | no source (D6) |
| Statistics filters (`m8Loju`, `RN0yw`) | URL filters via `parseFilterSearch` / `statistics-search` | available; period options to verify in U20 |
| Predefined teams (`b5RR4`) | `team_assignment_mode` PREDEFINED_TEAMS / POST_MATCH_TEAMS radios | mode available; pair pickers no source |
| Auto-confirm deadline (`JXjNs`, `alZmm`) | match result model deadline fields | relative label derivable |
| Level review request fields (`qWosG`) | evidence optional (`p_evidence`), min/max level, cancel RPC | range vs single level mismatch; id/ETA no source |
| Community stats "Avg. level", "Most active venue" (`o9iaC1`) | not in `CommunityStatistics` contract (months/weeks buckets and competitive/played exist) | no source |
| Offline queue (`ausNa`) | none; writes rejected | contradicts behavior (D2) |
| Public match access (`JLqMT`) | none; `_protected` guard | contradicts behavior (D3) |

## 7. Unit hold list

All decisions D1–D9 were answered on 2026-11-19. Only the D1 surfaces remain blocked (`blocked (frame pending)`) until the new frames land in `docs/design/padel-friend-clubhouse.pen`; all other holds below are released.

Units blocked until the corresponding decision is recorded and read back in Linear: U3/U14/U16/U21 (D2), U12 (D3), U4/U5/U9/U17 (D4), U4/U5/U18/U19 (D5), U5/U9/U11/U13/U18/U19/U20 (D6), U6/U7/U8/U15/U19/U22 (D7), U2–U4/U23/U24 (D8), U4 (D9), U6/U7/U14/U17–U21/U23 (D1).

## 8. Expected tests per unit (carry-over)

Each unit owns structural probes, state fixtures and visual evidence next to its code. Existing lanes to reuse: auth-visual, auth-return, auth-password-reset, onboarding, community-onboarding, community-lifecycle, community-admin, matches, matches-registration, matches-management, matches-results, result-amendments, leagues, level-reviews, player-ratings, statistics, notifications, push-preferences, pwa, offline-mutations, public-homepage-visual, result-repairs, home. Visual manifests follow `e2e/references/paf-201/manifest.json` conventions; U24 migrates legacy `test/*.visual-references.test.ts` pins from the legacy `.pen` to Clubhouse provenance.

## 9. Pencil agent prompt — missing frames (for owner)

Run in pen.dev on `docs/design/padel-friend-clubhouse.pen`:

> Extend the Padel Friend Clubhouse design with frames for 10 app surfaces that currently have no dedicated design. Match the established Clubhouse visual language exactly: reuse the token board frame `c1TsP` for color and typography (Figtree, semantic tokens, light + dark), the shared control treatments from the primitive frames (`Ilxwe` buttons/fields, `B3Uqv`, `QFH5u`, `RMese` chips/badges/cards), and the app shell and navigation patterns already drawn. Every new frame needs mobile width consistent with existing page frames, light and dark variants, and the states named below. Give each frame the exact name stated so implementation can reference it.
>
> 1. `privacy-policy` — Privacy Policy page: app header, page title, long-form legal text with section headings, back link; consistent with the public homepage frames.
> 2. `notification-detail` — Notification detail: back navigation, title, full notification body, outcome block (match result / level review outcome), timestamp, read/unread treatment.
> 3. `level-review-history` — Player level-review history: list of past review requests, each with date, requested level range, status chip (pending / approved / denied), decision note.
> 4. `platform-review-queue` — Platform level-review queue (admin): list or table of pending requests with player name, community, requested range, submitted date, status.
> 5. `platform-review-detail` — Platform level-review detail (admin): player header, current level range, request context, decision actions (approve / deny with note), audit trail.
> 6. `invite-confirmation` — Auth invite confirmation: success state (invitation accepted, continue to sign in), invalid/expired state with support hint, busy state.
> 7. `claim-password` — Provisional claim password step: create-password fields with rules, strength feedback, continue action, error state.
> 8. `claim-verify` — Provisional claim verification step: code entry, resend option, expired/invalid states.
> 9. `league-index` — League list: active and closed league cards/rows with name, season dates, participation status, create-league entry point.
> 10. `profile-edit` — Profile edit sheet/screen: avatar change, name, availability, preferences (theme/language), save/cancel actions; plus rating-journey chart detail states (expanded chart, empty history, error).
