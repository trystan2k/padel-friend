# Onboarding and player-profile fields

**Status:** Dominant hand is done (design and implementation). The remaining items — avatar in onboarding, preferred playing days/times, and private contact — are **deferred to a later Phase 2** and tracked in Linear as [`PAF-25`](https://linear.app/trystanworkspace2/issue/PAF-25/phase-2-player-profile-extras-avatar-in-onboarding-availability). They are not in current scope.

## 1. Purpose & sources

Reference for the user-provided and system-managed data in onboarding and the app-wide player profile. Schema claims use the migration and generated types; current UI claims use the player feature and English copy; product intent uses the PRD and onboarding task.

Sources:

- [PRD](../prd/padel-friends-prd-v1.md) — §§4, 7.1, 9.2, 10, 11.1–11.5, 12.1–12.7, 43.9, 69–70.
- [Auth and onboarding task](../tasks/01-auth-and-onboarding.md) — scope and acceptance criteria.
- [Player-profile and ratings migration](../../supabase/migrations/20260928000000_player_profiles_and_ratings.sql) — columns, constraints, defaults, triggers, grants, and RLS.
- [Generated database types](../../src/lib/supabase/database.types.ts) — typed table rows and RPC arguments.
- Current player UI/logic: [PlayerOnboarding](../../src/features/player/PlayerOnboarding.tsx), [PlayerProfile](../../src/features/player/PlayerProfile.tsx), [validators](../../src/features/player/player.validators.ts), [server mapping](../../src/features/player/player.server.ts), [server functions](../../src/features/player/player.functions.ts), [rating config](../../src/features/player/rating-config.ts).
- [English copy](../../src/locales/en/translation.json) — current field labels and options.
- [Pen design](padel-friend.pen) — onboarding frame `PdRtP` (read-only reference).

## 2. Field inventory

“Required?” describes the database requirement and, where applicable, the product requirement to provide the value. System-required fields are not user inputs. “Editable later?” means editable by the player through normal profile editing; rating-engine-managed fields are not direct profile edits.

| Field (DB column)                                         | Type / allowed values                                              | Required?                               | Captured in onboarding?              | Editable later?                                  | Source (PRD/migration)                                     | Notes                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `player_profiles.user_id`                                 | `uuid`, PK/FK to `auth.users.id`                                   | Yes — DB key                            | No — set from authenticated user     | No                                               | Migration; PRD §§10.3, 11                                  | Identity key, not sporting-profile copy.                                                                            |
| `player_profiles.display_name`                            | `text`, 1–80 characters; trimmed                                   | Yes — DB `NOT NULL`; PRD-required       | Yes — user input                     | Yes                                              | [PRD §11.1][prd]; [migration][migration]                   | Profile edit accepts this field.                                                                                    |
| `player_profiles.avatar_url`                              | Nullable `text`; user-owned avatar storage key, max 256 characters | No — nullable                           | No                                   | Yes                                              | [PRD §11.2][prd]; [migration][migration]                   | Initials fallback allowed. Current upload flow lives on profile; stored value is a key, not the signed display URL. |
| `player_profiles.preferred_side`                          | `text`: `LEFT`, `RIGHT`, `EITHER`                                  | Yes — DB `NOT NULL`; PRD-required       | Yes — user input                     | Yes                                              | [PRD §11.1][prd]; [migration][migration]                   |                                                                                                                     |
| `player_profiles.dominant_hand`                           | Nullable `text`: `LEFT`, `RIGHT`                                   | No — nullable; PRD-optional             | Yes — optional                       | Yes                                              | [PRD §11.3][prd]; [migration][migration]                   | “Prefer not to say” submits `dominant_hand = null`.                                                                 |
| `player_profiles.bio`                                     | Nullable `text`, max 280 characters                                | No — nullable; PRD-optional             | Yes — optional                       | Yes                                              | [PRD §11.3][prd]; [migration][migration]                   |                                                                                                                     |
| `player_profiles.created_at`                              | `timestamptz`, defaults to `now()`                                 | Yes — DB `NOT NULL`; system-set         | No — set on profile creation         | No                                               | [PRD §11.2][prd]; [migration][migration]                   | Used as profile join date.                                                                                          |
| `player_profiles.updated_at`                              | `timestamptz`, defaults to `now()`; updated by trigger             | Yes — DB `NOT NULL`; system-set         | No                                   | No — trigger-managed                             | [migration][migration]                                     |                                                                                                                     |
| `global_player_ratings.user_id`                           | `uuid`, PK/FK to `player_profiles.user_id`                         | Yes — DB key                            | No — linked by system                | No                                               | Migration; PRD §§7.1, 11                                   | One app-wide rating record per player.                                                                              |
| `global_player_ratings.initial_display_level`             | `numeric(3,1)`, 0.0–7.0; onboarding accepts 0.1 steps              | Yes — DB `NOT NULL`; PRD-required input | Yes — user selects initial level     | **No — immutable after onboarding**              | [PRD §§11.1, 12.1, 12.5][prd]; [migration][migration]      | Starting value. Do not confuse with the evolving current level.                                                     |
| `global_player_ratings.mu`                                | `numeric(4,2)`, 0.00–7.00                                          | Yes — DB `NOT NULL`; system-set         | No — initialized from selected level | No — rating-engine state                         | [migration][migration]                                     | PRD semantics not specified in docs.                                                                                |
| `global_player_ratings.sigma`                             | `numeric(3,2)`, greater than 0.00 and at most 7.00                 | Yes — DB `NOT NULL`; system-set         | No — initialized to `1.00`           | No — rating-engine state                         | [migration][migration]                                     | PRD semantics not specified in docs.                                                                                |
| `global_player_ratings.display_level`                     | `numeric(4,2)`, 0.00–7.00                                          | Yes — DB `NOT NULL`; system-set         | Yes — initialized from chosen level  | No direct profile edit; rating engine updates it | [PRD §§11.2, 12.1, 12.4–12.7][prd]; [migration][migration] | Match results can change current level; approved Platform/App Admin review can adjust it forward-only.              |
| `global_player_ratings.reliability_percent`               | `smallint`, 0–100                                                  | Yes — DB `NOT NULL`; system-set         | Yes — initialized to `10`            | No — rating-engine-managed                       | [PRD §§11.2, 12.2–12.3][prd]; [migration][migration]       | Starts at 10%; grows with confirmed competitive groups.                                                             |
| `global_player_ratings.confirmed_competitive_game_groups` | `integer`, ≥ 0                                                     | Yes — DB `NOT NULL`; system-set         | Yes — initialized to `0`             | No — rating-engine-managed                       | [PRD §§11.2, 12.2–12.3][prd]; [migration][migration]       |                                                                                                                     |
| `global_player_ratings.highest_display_level`             | `numeric(4,2)`, 0.00–7.00 and ≥ current level                      | Yes — DB `NOT NULL`; system-set         | Yes — initialized from chosen level  | No — rating-engine-managed                       | [PRD §11.2][prd]; [migration][migration]                   |                                                                                                                     |
| `global_player_ratings.last_rating_at`                    | Nullable `timestamptz`                                             | No — nullable                           | No                                   | No — system-managed                              | [migration][migration]                                     | Meaning and update conditions not specified in docs.                                                                |
| `global_player_ratings.rating_engine`                     | `text`, 1–64 characters                                            | Yes — DB `NOT NULL`; system-set         | No                                   | No — system-managed                              | [migration][migration]                                     | Initially `app-wide-level`; PRD not specified in docs.                                                              |
| `global_player_ratings.rating_engine_version`             | `text`, 1–32 characters                                            | Yes — DB `NOT NULL`; system-set         | No                                   | No — system-managed                              | [migration][migration]                                     | Initially `1.0.0`; PRD not specified in docs.                                                                       |
| `global_player_ratings.updated_at`                        | `timestamptz`, defaults to `now()`; updated by trigger             | Yes — DB `NOT NULL`; system-set         | No                                   | No — trigger-managed                             | [migration][migration]                                     |                                                                                                                     |

The PRD also names rating history (§11.2), which is not a column in either table; its storage shape is outside this field inventory.

## 3. What onboarding currently captures

| Field                | Required?                                   | Current rendering                                                                                                                                                   |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display name         | Required                                    | Text field near top of `PlayerOnboarding`, before level and side.                                                                                                   |
| Preferred court side | Required: Left, Right, or Either            | Radio choices after the main level slider.                                                                                                                          |
| Initial level        | Required: 0.0–7.0 in 0.1 steps              | Slider before the primary CTA; exact-tenth numeric input remains after the CTA.                                                                                     |
| Dominant hand        | Optional: Left, Right, or Prefer not to say | Three-option segmented control inside the preferred-court-side card, before the reliability card and CTA; defaults to “Prefer not to say” (`dominant_hand = null`). |
| Bio                  | Optional; up to 280 characters              | Text area in a trailing card after the primary CTA.                                                                                                                 |

Current implementation validates the required display-name, side, and initial-level fields; dominant hand and bio remain optional. “Prefer not to say” submits `dominant_hand = null` without a validation error. The hand control sits inside the preferred-court-side card, before the reliability card and primary “Save player profile” CTA. The exact-tenth numeric input and bio card remain after the CTA. Pen frame `PdRtP` shows the hand control but omits the exact-level input and bio. On the profile screen, name, side, hand, and bio are editable; hand keeps its own select with a clearing option, and avatar upload is a separate profile action. Current labels/options use `onboarding.*` and `profile.*` translation keys in en, pt-BR, and es.

## 4. UX follow-up status

1. **P1 — Dominant hand — DONE.** `PdRtP` now includes an optional Left / Right / Prefer not to say segmented control inside the preferred-court-side card, before the reliability card and CTA. “Prefer not to say” is the default and submits `dominant_hand = null` without validation error. Implementation and en/pt-BR/es labels are updated; DB support already exists (`player_profiles.dominant_hand`).
2. **P2 — Avatar — DEFERRED (Phase 2, PAF-25).** **What:** Decide whether to offer photo upload during onboarding. **Why:** PRD §11.2 lists avatar with initials fallback; current implementation exposes upload only on the profile screen. **DB status:** Exists (`player_profiles.avatar_url`; private avatar storage). **Recommendation:** Optional with initials/skip fallback; if included, place near display name/identity before the CTA. Keep later profile upload available.
3. **P3 — Preferred playing days/times — DEFERRED (Phase 2, PAF-25).** **What:** Add an availability input and profile-edit experience. **Why:** PRD §11.3 lists this as optional; current schema and onboarding validators have no such field. **DB status:** New migration needed; no column exists. **Recommendation:** Optional, outside the required core flow—place under optional availability/profile details and define values before implementation; format not specified in docs.
4. **P4 — Phone/contact data — DEFERRED (Phase 2, PAF-25).** **What:** Add a private contact field and controlled visibility behavior. **Why:** PRD §11.3 lists phone/contact as optional and private by default; §11.4 says auth email/security data must not be automatically exposed. **DB status:** New migration and explicit privacy/visibility rules needed; no column exists. **Recommendation:** Optional, in a separate private contact section (preferably profile/settings, not the sporting-profile card); never surface it as sporting-profile data.

## 5. Explicitly NOT onboarding/profile fields

- **City/area:** PRD §9.2 lists this as an optional _community_ field, not a player field. Arbitrary nearby-player geolocation discovery is a V1 non-goal (§4).
- **UI language:** PRD §70 treats locale as an internationalization/display concern and says initial locales can be chosen later; no player-profile field or onboarding capture is specified. Persistence per user is not specified in docs.
- **Timezone:** PRD §69 says use community timezone for match scheduling by default and store timestamps canonically; timezone is not a player-profile column or onboarding input. User-specific timezone storage is not specified in docs.
- **Notification preferences:** PRD §43.9 calls for separate per-user notification preferences; these are not player-profile fields or onboarding inputs. Their precise storage/placement is not specified in docs.

## 6. Key rules

- **Initial level is write-once:** the player cannot directly edit it after onboarding (PRD §12.5). Current displayed level is rating-engine-managed and evolves from eligible results; an approved Platform/App Admin review can adjust it forward-only (PRD §§12.4, 12.7).
- **Keep auth email private:** authentication identity and player profile are separate; auth email/security data must not automatically be exposed as sporting-profile data (PRD §§10.3, 11.4; onboarding task).
- **Respect DB update grants:** authenticated profile updates are limited to `display_name`, `avatar_url`, `preferred_side`, `dominant_hand`, and `bio` (migration). Rating fields and timestamps are not included in those grants.

## 7. Follow-up checklist

### Pen design

- [x] Update `PdRtP` with optional dominant-hand selection before the CTA; “Prefer not to say” defaults to null.
- [ ] Decide whether avatar belongs in onboarding; preserve initials fallback and profile upload.
- [ ] Keep optional availability/contact distinct from required core onboarding; show private-by-default behavior for any contact UI.

### Implementation / backlog

- [x] Implement optional dominant-hand control, nullable submission, and en/pt-BR/es labels; keep the profile-edit select with its clearing option.
- [ ] Create availability schema/API/profile-edit work for preferred playing days/times; define supported values first.
- [ ] Create contact-data migration and explicit RLS/visibility rules; prevent sporting-profile exposure.

Avatar, availability, and private contact are **deferred to Phase 2** and tracked in [`PAF-25`](https://linear.app/trystanworkspace2/issue/PAF-25/phase-2-player-profile-extras-avatar-in-onboarding-availability); the unchecked items above stay unchecked until that work is scheduled. Availability and contact require migrations (contact also needs visibility rules).

[prd]: ../prd/padel-friends-prd-v1.md
[migration]: ../../supabase/migrations/20260928000000_player_profiles_and_ratings.sql
