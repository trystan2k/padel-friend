# Changelog

## [0.2.0](https://github.com/trystan2k/padel-friend/compare/padel-friend-v0.1.0...padel-friend-v0.2.0) (2026-11-14)


### Features

* add audited player level reviews with forward-only rating adjustments ([#42](https://github.com/trystan2k/padel-friend/issues/42)) ([f2104de](https://github.com/trystan2k/padel-friend/commit/f2104de43ff7864eaa833f6fcdaa30ca8b44d371))
* add audited result corrections with deterministic replay and repair diagnostics ([#43](https://github.com/trystan2k/padel-friend/issues/43)) ([1f790f3](https://github.com/trystan2k/padel-friend/commit/1f790f3157265bacca635fb460a14aea66d2f101))
* add authentication and app-wide player onboarding ([#1](https://github.com/trystan2k/padel-friend/issues/1)) ([de79fdf](https://github.com/trystan2k/padel-friend/commit/de79fdfe866409dff3a3de546a8426d63fb53de0))
* add community leagues with creation, lifecycle, and management UI ([#39](https://github.com/trystan2k/padel-friend/issues/39)) ([21d5488](https://github.com/trystan2k/padel-friend/commit/21d54883a885f2c8bd7766c5b7102362364106d4))
* add immutable rating ledger and initialization audit ([2c5f63b](https://github.com/trystan2k/padel-friend/commit/2c5f63bbf59b45f2c50abf66ba499bec89095f2d))
* add league standings calculation, close, and versioned history ([#40](https://github.com/trystan2k/padel-friend/issues/40)) ([e436591](https://github.com/trystan2k/padel-friend/commit/e4365917e35e8a6d3b436e4b760f5541d05bcb27))
* add match invitation lifecycle ([76b6ba7](https://github.com/trystan2k/padel-friend/commit/76b6ba742d30908faab7eeb51310d71125e1c52e))
* add provisional player identity foundation ([#37](https://github.com/trystan2k/padel-friend/issues/37)) ([ba53af7](https://github.com/trystan2k/padel-friend/commit/ba53af7ed1ca108ee89aa7f30dfdd6b4ed5a5d67))
* add public community discovery with privacy-safe responses ([#6](https://github.com/trystan2k/padel-friend/issues/6)) ([151858e](https://github.com/trystan2k/padel-friend/commit/151858ea81747111f258ce1cb3f743077200f87e))
* add result review and confirmation contracts ([#35](https://github.com/trystan2k/padel-friend/issues/35)) ([6aca92e](https://github.com/trystan2k/padel-friend/commit/6aca92e5ac96943b31c30736eced0332ca4cbc87))
* assemble community Home with realtime convergence, privacy isolation, and release integrity ([#47](https://github.com/trystan2k/padel-friend/issues/47)) ([d2b5f40](https://github.com/trystan2k/padel-friend/commit/d2b5f40fcec451f5c0704f4c12621e5a70a2b541))
* community discovery counts and admin expansion ([a706f9c](https://github.com/trystan2k/padel-friend/commit/a706f9c6ad70be1c76e11700a073469d17a488d8))
* community domain model with RLS and role-matrix tests ([#3](https://github.com/trystan2k/padel-friend/issues/3)) ([ffe56a2](https://github.com/trystan2k/padel-friend/commit/ffe56a29b7438e05d0a4a7ca1d029d2429214313))
* community request pagination freshness and locale persistence fixes ([#27](https://github.com/trystan2k/padel-friend/issues/27)) ([d4f2c9b](https://github.com/trystan2k/padel-friend/commit/d4f2c9bba4337aa8be02945bb36306e77b0de1ad))
* create and discover match events ([#21](https://github.com/trystan2k/padel-friend/issues/21)) ([44e8197](https://github.com/trystan2k/padel-friend/commit/44e8197b0741013de521f48414eb44aa508e01a8))
* dedicated test Supabase stack — full dev/test database separation ([#55](https://github.com/trystan2k/padel-friend/issues/55)) ([94636ff](https://github.com/trystan2k/padel-friend/commit/94636ff29e78bf4dcda171ded35e703d01db1bb1))
* deliver installable PWA and Web Push with in-app fallback ([#46](https://github.com/trystan2k/padel-friend/issues/46)) ([b0e65be](https://github.com/trystan2k/padel-friend/commit/b0e65be25b00f6c10ecc7947cd3a6544ce10e397))
* former-participant League read access and fact-preservation certification ([#50](https://github.com/trystan2k/padel-friend/issues/50)) ([91ed689](https://github.com/trystan2k/padel-friend/commit/91ed689fa55c0ea7f1cf95039f8c852dc177b942))
* gate production releases and automate database migrations ([#56](https://github.com/trystan2k/padel-friend/issues/56)) ([e70c31f](https://github.com/trystan2k/padel-friend/commit/e70c31fdc509a035abc1ce01a8482865c1d32afa))
* initialize Padel Friend from tanstack-worker-template ([d721644](https://github.com/trystan2k/padel-friend/commit/d7216443f68be0d83be0e88dfc2a655e8cada2e1))
* persist and display in-app notifications ([#20](https://github.com/trystan2k/padel-friend/issues/20)) ([b24d1b1](https://github.com/trystan2k/padel-friend/commit/b24d1b1411727a708aef8e833439248713db6e88))
* player profile extras: onboarding avatar and availability preferences ([#54](https://github.com/trystan2k/padel-friend/issues/54)) ([2f4431a](https://github.com/trystan2k/padel-friend/commit/2f4431af5af2b8cd03f4da92bd10ebb93b3d8cb3))
* record actual teams and scored match results ([#32](https://github.com/trystan2k/padel-friend/issues/32)) ([e08092b](https://github.com/trystan2k/padel-friend/commit/e08092b256088f313376f0c8e8306828ede45e2e))
* reduce integration test runtime without weakening coverage ([#49](https://github.com/trystan2k/padel-friend/issues/49)) ([4038b47](https://github.com/trystan2k/padel-friend/commit/4038b47574580c9008c853a4e312d0f88d61fbd4))
* register players, approve requests, and form FIFO quartets ([#22](https://github.com/trystan2k/padel-friend/issues/22)) ([ba8ef88](https://github.com/trystan2k/padel-friend/commit/ba8ef880b385d8997e89a61eee71f2ef3ac3234f))
* rename mcp_engram to engram and add stylex dev support ([c0bcadf](https://github.com/trystan2k/padel-friend/commit/c0bcadfe90dba718777f11dea5e5b015117288ae))
* show match, player, pair, opponent, and community statistics ([#41](https://github.com/trystan2k/padel-friend/issues/41)) ([7f2af56](https://github.com/trystan2k/padel-friend/commit/7f2af56f4843a564a348026b6f185be743dc7f8c))
* speed up test suite timing across CI and local gates ([#44](https://github.com/trystan2k/padel-friend/issues/44)) ([5f5d79b](https://github.com/trystan2k/padel-friend/commit/5f5d79b7b7f6ac56d01c3c448d42bfe7cd746eeb))
* stabilize serial-lane e2e specs (push/pwa SW timeouts and legacy rotating flakes) ([#52](https://github.com/trystan2k/padel-friend/issues/52)) ([cd1b62d](https://github.com/trystan2k/padel-friend/commit/cd1b62de3ccc1035290dd3d867a4075a56b657ee))
* stabilize the four documented e2e flake classes fenced only by CI retries ([#51](https://github.com/trystan2k/padel-friend/issues/51)) ([afccf0d](https://github.com/trystan2k/padel-friend/commit/afccf0d594f43ca0576160181902748b2d7f1599))
* test infra: assert stalled sweep on the CLI child's real termination ([#53](https://github.com/trystan2k/padel-friend/issues/53)) ([7ddd72a](https://github.com/trystan2k/padel-friend/commit/7ddd72a4cc0b0f631a8852f5a4ab4f4242fcdb79))


### Bug Fixes

* community correctness hardening for settings sizing, governance audit, and timeline truncation ([#13](https://github.com/trystan2k/padel-friend/issues/13)) ([65c1b0f](https://github.com/trystan2k/padel-friend/commit/65c1b0fdf25d75781f0603ce5af912fee424350c))
* enable row level security on internal registration tables ([5c283b3](https://github.com/trystan2k/padel-friend/commit/5c283b3b2df319fba53f22902ab0fabc72b74c4d))
* harden E2E gate and formatting config ([#16](https://github.com/trystan2k/padel-friend/issues/16)) ([2675a0e](https://github.com/trystan2k/padel-friend/commit/2675a0ecd2c125d4314609d953ddb122ba58921f))
* rebuild login journey and extract reusable UI primitives ([#2](https://github.com/trystan2k/padel-friend/issues/2)) ([efc83b7](https://github.com/trystan2k/padel-friend/commit/efc83b77827ec628edd4f6522b90d3293b6eb7c1))
* tier 1 security, tooling, and privacy hardening for communities ([#12](https://github.com/trystan2k/padel-friend/issues/12)) ([1fde427](https://github.com/trystan2k/padel-friend/commit/1fde42729949b8b2015c3c54994455646a3dbc04))


### Performance Improvements

* index notification category feeds ([#30](https://github.com/trystan2k/padel-friend/issues/30)) ([20fb8f7](https://github.com/trystan2k/padel-friend/commit/20fb8f79a327b8b44b92a1b1dcc4078b9cf683fe))
