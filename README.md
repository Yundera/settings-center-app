# Yundera admin app (settings-center-app)

The Yundera layer of a Personal Cloud Server, at `admin-<domain>` (the Maison
**Yundera** tile). For the box's owner it answers three questions — is my server
healthy, is it up to date, and where do I find everything else — and holds the
few things only Yundera does: the nightly health check, the Yundera features an
owner may switch off, support access and reports, and the first-run onboarding
(one slide per topic: the owner account, backups). For the Yundera control plane it serves the public routes it polls and
pushes to.

It is written for people new to self-hosting: every page opens with what it is
for, and every technical word has a "?" explanation. English and French today;
another language is one more `web/messages/<locale>.json`.

Go + an embedded Svelte UI, ~35 MB image, ~10 MB resident — the same pattern as
mesh-console and auth-console. It replaced a Next.js/react-admin app (1.x) in 2.0.

## Pages

| Page | Shows | Acts |
|---|---|---|
| **Overview** `/` | Domain, public IP, a verdict, five tiles (health check, updates, connection to Yundera, storage, support access), what needs attention, shortcuts | Restart the server |
| **Health check** `/checkup` | The latest self-check step by step, failures with their output, the schedule, the raw log | Run now, change the schedule |
| **Yundera features** `/features` | Yundera Login, the support key, platform updates — what each does and what turning it off costs; what cannot be switched off yet | Switch them (with lock-out guards); update channel; re-run onboarding |
| **Support** `/support` | Whether Yundera support can sign in | Grant / revoke access; write to support with the log attached |
| **All tools** `/tools` | What Maison, its backups, Kopia, auth-console, mesh-console and the Yundera dashboard are for, and when to go there | Links |

Page paths avoid the ones the AppShield gate answers itself (`/health`,
`/login`, `/nhl-auth/*`, `/AppShield/*`, `/.well-known/*`): a page there never
reaches this app. Panels that moved out answer their old links: `#/access` and `#/account` go to
auth-console, `#/domain` to mesh-console (`web/src/lib/legacyHash.ts`).

## How it works

```
browser ─► admin (AppShield gate) ─► admin-app :80
                                       │  X-AppShield-Assertion (HS256) verified per request
                                       ├─ /yundera (read-only): log, .pcs.env, env files
                                       ├─ /app/data: identity-state.json
                                       └─ docker.sock ─► one-shot privileged runner
                                                          nsenter -t 1 … template tools
```

- **Auth.** The gate owns sign-in. The app trusts only the signed assertion
  (`internal/auth`), never `Remote-*` headers — every container on `pcs` can reach
  it. `/api/*` needs a person in `admins`; `/api/me` and the onboarding status
  need any signed-in person. No secret ⇒ nothing works.
- **Host actions** (`internal/hostverb`, `internal/hostrun`) run in a sibling
  container created from this image, in the host's namespaces. Each is a fixed
  builder over the template's own tools (`self-check.sh`, `tools/feature-*.sh`,
  `tools/onboarding.sh`, `tools/backup.sh`, `tools/apply-identity.sh`,
  `tools/env-file-manager.sh`); inputs are validated argv, secrets (the account
  and backup passwords, the identity bundle) go on stdin.
- **Status** (`internal/status`) is a pure function returning codes; the UI
  owns the words (`web/messages`).

### Public routes (contracts)

| Route | Consumer | Notes |
|---|---|---|
| `GET /api/health` | pcs-orchestrator (`parseAdminHealth`, `pcs list-health-check`) | RAM snapshot, refreshed every 5 min |
| `GET /api/perf` | `pcs perf` / `list-perf` | host sample every 5 min |
| `GET /api/bench/{disk,network}` | `pcs perf` | lazy, 10-min cooldown |
| `GET /api/identity/key`, `POST /api/identity/push` | the orchestrator's identity push (`doc/identity-push.md`) | the bundle authenticates itself |
| `GET/POST /api/feedback/ingest` | Maison's "Send feedback" | bearer `FEEDBACK_TOKEN` |
| `GET /api/onboarding/check` | Maison, on every page load (its managed `onboarding` setting) | bearer `ONBOARDING_CHECK_TOKEN`; `{"show","url"}` from RAM; **not** in the gate's ALLOWED_PATHS |

Their shapes are pinned by tests against responses captured from v1
(`internal/*/testdata`), and the identity push against a JWE produced by the
orchestrator's own code (`internal/identity/testdata/gen.mjs`).

### Onboarding

One slide per topic, Back / Next / "Skip for now", then a closing card that
marks it completed (`tools/onboarding.sh mark-completed`):

| Slide | Done when | Acts through |
|---|---|---|
| `account` | the box is claimed (a local owner account exists) | `onboarding.sh run`; Yundera Login via `POST /api/features`, switched off only after the claim |
| `backup` | `backup.sh status` reports `ready` or `disabled` | `POST /api/backup` → `backup.sh status\|enable\|disable\|init\|recover\|reset --confirm` |

Backup states: `needs-secret` (empty space, choose a password → `init`),
`needs-recovery` (old backups found → `recover` with the old password, or
`reset` to wipe the space and choose a new one), `ready`, `disabled`,
`unavailable` (skippable, points to support). Backup passwords are ≥16
characters, on stdin only. Every action but `status` outlasts an HTTP request
(recover can take ~16 min), so `POST /api/backup` answers 202 and runs it as
a background job — one at a time, 409 `backup_busy` otherwise — whose result
the UI polls on `GET /api/backup/job`.

A skipped slide is stored in `${DATA_DIR}/onboarding-skips.json`
(`{"<slide>": "<RFC3339>"}`) and becomes pending again 72 h later. While any
slide is pending, `GET /api/onboarding/check` answers
`{"show": true, "url": "https://admin-<domain>/"}` and Maison 303s the owner
here with `?return=<its URL>`. The answer comes from a snapshot refreshed every
minute and right after any onboarding, feature or backup change, so the check
never runs a host verb inline; a `backup.sh` failure never turns it on.

## Configuration

| Env | Default | |
|---|---|---|
| `IDENTITY_ASSERTION_SECRET` | — | shared with the gate; required |
| `IDENTITY_ASSERTION_AUDIENCE` | `admin` | the gate's APP_NAME |
| `APPSHIELD_GATE_URL` | `http://admin` | session revocation |
| `COMPOSE_FOLDER_PATH` | `/DATA/AppData/yundera` | the Yundera root, host view |
| `YUNDERA_DIR` | `/yundera` | the same tree, mounted read-only |
| `SELF_CONTAINER` / `RUNNER_IMAGE` | `admin-app` / — | how the runner finds its image |
| `DOMAIN`, `UID`, `PUBLIC_IP` | — | box identity |
| `OPERATOR_API` | `https://app.yundera.com/service/pcs` | support key, identity issuer, dashboard link |
| `SUPPORT_EMAIL`, `FEEDBACK_EMAIL` | `support@yundera.com` | recipients |
| `FEEDBACK_TOKEN` | — | unset ⇒ feedback 404 |
| `ONBOARDING_CHECK_TOKEN` | — | unset ⇒ onboarding check 404 (Maison then never redirects) |
| `UPSTREAM_LOGOUT_URL` | — | ends the Authelia session at logout |
| `SMTP_HOST` / `SMTP_PORT` | `smtp` / `587` | the mesh relay |
| `DEV_IDENTITY`, `ADMIN_ENV=development` | — | fake admin, only without a secret |

`TRUST_ISSUER` (identity push), `UPDATE_URL`, `SELF_CHECK_CRON` and
`ENSURE_SUPPORT_KEY` are read from `.pcs.env` on every request.

## Development

No local Go or Node needed:

```bash
docker run --rm -v "$PWD/web":/src -w /src node:22 sh -c 'npm ci && npm run check && npm run build'
docker run --rm -v "$PWD":/src -w /src golang:1.25 sh -c 'go vet ./... && go test ./...'
docker build -t settings-center-app:dev .
```

`vite build` overwrites the tracked placeholder `internal/ui/dist/index.html`;
restore it before committing. Run the image with `ADMIN_ENV=development
DEV_IDENTITY=you` and a fixture tree mounted on `/yundera` to see the UI; host
actions need the Docker socket and are best tried on a test PCS.

## Release

Tag `vX.Y.Z` → GitHub Actions publishes `ghcr.io/yundera/settings-center-app:X.Y.Z`
(amd64 + arm64). The pin is the `admin-app` image in template-root's
`root/docker-compose.yml`.
