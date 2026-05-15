# PCS Migration — Design Notes

Design brainstorm for the admin-panel "Migration" page that copies a running PCS (source) onto a freshly-provisioned PCS (target), producing a byte-for-byte identity takeover.

Status: design, not yet implemented.

## Goal

From the target PCS's admin panel, the operator enters the source PCS's IP / user / password and the target becomes the source: same domain, same apps, same data, same keys. The source is left powered-off so the target is the only PCS serving the user's domain.

Design stance: **intentional impersonation is the goal**, not a side-effect. Identity material (mesh-router keys, CasaOS DB, etc.) is migrated deliberately. A small post-copy patch step updates the values that *must* differ (IP, and whatever else we discover during testing).

## High-level flow

1. **Preflight / test connection** — SSH reachability, sudo, disk space, UID parity sanity, parse source compose files.
2. **Online copy** — `rsync /DATA` from source to target while source is still serving traffic.
3. **Image prefetch** — on target, `docker pull` every image referenced by the source's compose files (parsed from the just-copied tree).
4. **Stop source** — `docker compose down` for every yundera-managed stack on the source **and disable the self-check cron** (see JWT rotation note below). Source host stays up; only its containers and cron stop.
5. **Offline diff copy** — second `rsync` pass to capture anything that changed during step 2, with `--delete`.
6. **Self-check on target** — run the template self-check (`scripts/self-check/` via `scripts-config.txt`). This is the finish line, not a separate "env patch + compose up": it re-detects the target's public IP and overwrites the copied value, validates env, re-fetches user data using the copied `USER_JWT` (which also acts as our acceptance test that identity transferred), and brings the compose stacks up. Existing auth secrets (Authelia session/storage/reset + OIDC JWKS) are preserved because each `ensure-*` is idempotent and skips when files exist.
7. **Webhook** (optional) — fire configured callback with status + summary. Short timeout, fire-and-forget.

Steps 2 and 3 can run in parallel.

## Auth model

- Password is used **once**, to push a short-lived SSH key pair into a dedicated **migration account** on the source (created for this migration, sudoer, deleted at the end).
- All subsequent SSH (rsync, compose down, inspection) uses the key.
- Password is never persisted, never logged, zeroed from memory as soon as the key is in place.
- Migration account + its authorized_keys entry is removed in the success path *and* in the rollback path.

Open question: should we offer "use existing account + paste key" as an alternative for users who don't want to hand over root/sudo password? Probably yes, as an advanced option.

## What gets copied

Target is a blank freshly-provisioned PCS, so the policy is **copy everything under `/DATA` including identity material**. No allowlist gymnastics — that was an earlier concern that resolves once we commit to full impersonation on a blank target.

- `rsync -aHAX --numeric-ids --info=progress2` — preserves perms, ACLs, xattrs, hardlinks, and UIDs numerically.
- UIDs: target is blank, so we accept whatever UIDs come from source. No remapping. Preflight still sanity-checks that the `yundera`/`casaos` service users exist on target with compatible UIDs, or creates them to match.
- Second pass uses `--delete` so files removed on source between pass 1 and pass 2 are removed on target.

## Identity transfer: what carries the PCS identity

The PCS identity is a single bearer token: `USER_JWT`, stored at `/DATA/AppData/casaos/apps/yundera/.pcs.secret.env`. `ensure-yundera-user-data.sh` calls `${YUNDERA_API}/user/info` (default `https://app.yundera.com/service/pcs/user/info`) with that token and receives back `{uid, email, domain, domainSignature → PROVIDER_STR, userJWT}`. Copying the JWT is the identity takeover — no keypair push, no backend-side re-registration needed from our side.

### JWT rotation (sharp edge)

The backend **rotates the JWT on every `/info` call** (see `ensure-yundera-user-data.sh:81` — `RECV_USER_JWT` is written back). Implications:

- Between pass-1 and pass-2 rsync, if the source's self-check cron fires, the JWT changes. Pass 2 captures the new one — fine.
- After migration, **source must stay down, including its self-check cron.** If source comes back up and runs a self-check, it calls `/info` with the JWT we copied (now the "old" token from the backend's point of view — actually still valid since it hasn't been rotated yet from the backend's perspective until someone uses it), rotates it, and now the backend's current JWT no longer matches what target has. Target's next cron fails to authenticate, identity silently breaks.
- Therefore step 4 ("stop source") must disable the self-check cron on source, not just `docker compose down`. Re-enabling it is part of the rollback path if we re-up the source.

## Env values that do NOT need manual patching

- **`PUBLIC_IP`, `PUBLIC_IPV4`, `PUBLIC_IPV6`** (and their `_DASH` variants) — `ensure-public-ip.sh` re-detects from the target's actual interface (`ens19` for v6, `curl ident.me` for v4) and overwrites whatever the copied `.pcs.env` had.
- **`UID`, `DOMAIN`, `EMAIL`** — `ensure-yundera-user-data.sh` re-fetches these from the backend using the copied `USER_JWT` and writes them to `.ynd.user.env`.
- **Authelia secrets** (`session`, `storage`, `reset`, `oidc-hmac`, `oidc/private.pem`) — `ensure-auth-secrets.sh` only generates when files are missing, so the copied ones are preserved. **Important that we preserve these**: the OIDC private key is what signs tokens for every registered OIDC client; regenerating it would invalidate every app's SSO.

### Env values to watch during first test runs

Empirical list — add as testing surfaces new cases. Current known-nothing-to-patch set is believed complete. Candidates if something surprises us:
- hostname baked into CasaOS DB
- anything in per-app `/DATA/AppData/*/` that pins an IP or hostname

## Preflight checks (fail fast, before any data moves)

- SSH reaches source with provided creds.
- Source user is sudoer (`sudo -n true` after key push, or test with password).
- Target free space on `/DATA` ≥ `du -sb /DATA` on source × safety margin (e.g. 1.1×).
- Source's compose files parse; we can enumerate images.
- Target has network reach to every registry the source's images live in.
- Target has no pre-existing apps under `/DATA/AppData` that would collide (fresh target invariant).
- Clock skew between source and target is sane (rsync mtimes).

## Direction and "detached script" question

The migration runs **from the target's admin panel**. The target SSHes into the source to stop containers. Since `sshd` on the source is a host process and not one of the stacks we're stopping, the SSH session survives `compose down` — no detached host-side script is needed.

We deliberately **do not** support running migration from the source's admin panel. If we ever do, we'd need a host-level detached script on the source (because the admin panel itself is a container that would stop mid-migration). Not building that now.

## Rollback

Invariant: **there is always exactly one PCS serving the user's domain**, so the user can recover via the UI at any point.

- If **preflight** fails: nothing started, surface error, source still serving. No rollback needed.
- If **online copy** fails: source still serving, target is partially populated. Wipe target `/DATA`, user retries. No rollback needed (source never stopped).
- If **image pull** fails: same as above.
- If **offline copy** fails: source is down. **Re-enable source's self-check cron and re-`up` the source**, abort migration, target wiped on retry.
- If **target self-check** fails (IP detect, user-data fetch, or compose up on target): source is down. **Re-enable source's cron and re-`up` the source** so the user regains a serving UI, mark migration failed, leave target in place for debugging. Do not auto-retry.
- **Never** leave both source and target down. Never leave both up (split-brain: both running self-check crons will fight over JWT rotation).

Cleanup in every terminal path: remove the migration account and its key from the source. On rollback specifically: also re-enable the source's self-check cron — easy to forget and it's what keeps source's identity refreshed.

## Progress / UX

- Stream `rsync --info=progress2` to the UI (SSE or WebSocket). Real-time %, throughput, ETA.
- Show per-step status with timestamps: preflight → online copy → image pull → stop source → diff copy → env patch → start target → webhook.
- A real PCS `/DATA` can be hundreds of GB or terabytes. Hour-scale runs are expected. The UI must not assume seconds-scale.
- Log everything server-side to a file the user can download if the run fails.

## Webhook

- URL configured as an option on the migration page.
- Fire once at the end (success or failure).
- Payload: status, start/end timestamps, duration, bytes transferred, image count, stack count, error message if any.
- Short timeout (e.g. 5s), no retry — webhook failure does not mark the migration failed.

## Security notes

- Password never hits disk, never hits logs, lives in memory only long enough to push a key.
- Migration account is sudoer with password-less sudo only for the duration of the run, via an authorized_keys `command=` or a sudoers.d drop-in that we remove at the end.
- Webhook URL is user-supplied — treat it as untrusted, no redirects followed, HTTPS only, domain not pinned but payload contains no secrets.
- All SSH with `StrictHostKeyChecking=accept-new` on first contact, pinned thereafter for this run.

## Open questions

- Do we support resuming a failed migration, or always start fresh? Default: start fresh (simpler, and rsync's second pass is already cheap on a mostly-complete target).
- What's the cleanest way to disable the source's self-check cron? (Likely a flag file the cron job reads, or `systemctl disable` + `crontab -r`-style surgery. Needs to be reversible for rollback.)
- Does the backend's `/info` endpoint silently care about the *calling IP* in addition to the JWT? It shouldn't based on the script — only the Bearer token is sent — but worth confirming with one test migration before we trust it.
- Empirical env-value discoveries from first test migrations — list is in "Env values to watch" above.
