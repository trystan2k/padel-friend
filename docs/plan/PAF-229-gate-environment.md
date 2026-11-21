# PAF-229 gate environment incident

- 2026-11-20: `pnpm complete-check` (shell `sh_1f8ea152c001JaTcsGze7rZ6dO`, log `/tmp/complete-check-u24-2.log`) stopped by SIGTERM after ~2h22m in serial integration. Environment failure, not a test failure. The test DB had restarted mid-run per orchestrator diagnosis; sibling containers had different uptimes, several individual tests took 15–18 minutes, and the run did not emit a final integration or E2E result. Do not use its assertions for certification.
- Verified the shell and descendants before terminating their process groups (19301, 19303, 29857, 30218; requested PIDs 19319, 29876, 30217, 30218). The shell supervisor recorded exit 143.
