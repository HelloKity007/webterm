# Boot persistence and rb-1.1.10 release record

Status: production 9443 runs `b8ebccf6859225caacd24d06dc4d6fe81aefb630`
(rb-1.1.10), user-verified.

## Boot persistence (fix for "9443 unreachable after reboot")

Root cause: `lan-up.sh` only detached background processes with pidfiles;
nothing survived a reboot, and `lan-secrets.env` still pointed at the
pre-migration certificate directory, so even manual startup failed.

- `scripts/lan-exec-webterm.sh` — foreground launcher reusing the full
  `lan-lib.sh` preflight (permissions, TLS material, tmux pin validation).
- `scripts/systemd/webterm-lan.service` (production webterm on
  127.0.0.1:8888, `Restart=on-failure`) and `webterm-lan-caddy.service`
  (Caddy gateway :9443/:9444, `Wants=`/`After=` — deliberately not
  `Requires=`, so restarting the backend does not stop the gateway; the
  original `Requires=` coupling took 9443 down once during this release
  and was fixed on the spot).
- Both units `enabled`; LAN TLS certificate re-issued with mkcert into
  `certs/` (gitignored) and `lan-secrets.env` updated.
- Verified: both services `active`, ports 8888/9443/9444 listening,
  `curl https://192.168.11.87:9443` returns 200 with the WebTerm page.

## Production health watchdog

`scripts/prod-watchdog.sh` + `webterm-watchdog.service`/`.timer`
(30s cadence): three consecutive failures of the local 8888 health check
restore `runtime/production/webterm.previous` (recorded at each promote)
and restart `webterm-lan` once; a rollback lock prevents loops. Stop the
timer during intentional long maintenance.

## Release record

- `dev-1.1.2` commits `148c610` (auto-recovery, wheel gate, systemd),
  `b8ebccf` (ignore local agent tool state), `a1eedd0` (gateway decouple).
- rb branch `rb-1.1.10` fast-forwarded to `a1eedd0`; both pushed to origin.
- Ceremony: clean-tree `release-deploy.sh` to 9444 (full test suite inside),
  `release-approve.sh`, then production swap via systemd + public 9443
  health check; previous binary retained at
  `runtime/production/webterm.previous` (version `dev`).
- The full AGENTS.md dynamic visual matrix was NOT re-run for this release;
  coverage was the automated suites plus the targeted Playwright
  verifications above. Marked NOT RUN, not PASS.
