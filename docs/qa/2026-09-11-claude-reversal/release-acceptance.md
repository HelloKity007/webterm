# 1.0.3 release authorization

The user accepted the current PC experience and explicitly authorized committing
and pushing dev-1.0.3, publishing rb-1.0.3, and deploying production.
This does not claim mobile acceptance.

Environment policy for this and subsequent releases:

- Production 9443 retains normal authentication. Test-session auto-login must
  return 404 in production, even if its flag is mistakenly supplied.
- Test 9444 defaults to admin auto-login via the release launcher. This is an
  intentionally privileged test environment, not suitable for public exposure.
- Develop directly in the main repository, not worktrees.

Release through release-deploy.sh, release-approve.sh and release-promote.sh.
The promotion script preserves the previous production executable and performs
automatic rollback on failed production health checks. Manual rollback is
scripts/release-rollback.sh. Production database is not replaced by test data.

Post-deploy checks must verify production health/version, unauthenticated API
denial, disabled test-session endpoint and normal login, plus continuing test
auto-login. See the release execution result for the deployed commit.
