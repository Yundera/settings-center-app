# Dev stack

Runs the Settings Center App inside a simulated Personal Cloud Server, behind
the same auth topology the prod template ships — so the login path you exercise
here is the login path that runs on a real PCS.

```
browser ──► admin-dev.localhost         this app (Next.js dev mode, fast refresh)
               │ OIDC authorization_code
               ▼
           auth-dev.localhost           Dex — the broker every PCS app delegates to
               │ "Local Account" connector
               ▼
        local-auth-dev.localhost        Authelia — the local credential store
                                        (users_database.yml lives here)
```

Every modern browser resolves `*.localhost` to `127.0.0.1` (RFC 6761), so there
are no `/etc/hosts` edits. Services are published as **siblings** of `DOMAIN` —
`admin-dev.localhost`, not `admin.dev.localhost` — because that `<service>-<domain>`
shape is what auth-registrar validates redirect URIs against.

## Quick start

```bash
cp .env.example .env      # defaults boot as-is
docker compose up -d --build
```

Then open **https://admin-dev.localhost/** and log in as `admin` with the
`DEFAULT_PWD` from `.env` (default: `admin`).

First boot takes a few minutes: two images build, four are pulled, and the
provisioning scripts run.

### Trusting the dev CA (optional)

`bootstrap.sh` mints a local CA and a server certificate for the three
hostnames. Until you trust it, browsers warn and `curl` needs `-k`.

```bash
docker compose cp pcs-host:/certs/ca.pem ./dev-ca.pem
# Linux: sudo cp dev-ca.pem /usr/local/share/ca-certificates/yundera-dev.crt && sudo update-ca-certificates
# macOS: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain dev-ca.pem
# Windows: certutil -addstore -user Root dev-ca.pem
# Or just click through — the browser remembers per-domain.
```

The containers already trust it: `admin` via `NODE_EXTRA_CA_CERTS`, `dex` via
`SSL_CERT_FILE`.

## Services

| Service | Container | Role |
|---|---|---|
| `pcs-host` | `pcs-host` | Simulated PCS VM. Holds the template tree, runs the provisioning scripts, and is the SSH target for every privileged dashboard operation. |
| `admin` | `admin` | The app under test. Name must be `admin` — auth-registrar derives the OIDC client id from a PTR lookup. |
| `dex` | `dex` | OIDC broker at `auth-${DOMAIN}`. What the dashboard actually authenticates against. |
| `authelia` | `authelia` | Local credential store at `local-auth-${DOMAIN}`. Serves its own login + password-reset UI. |
| `auth-registrar` | `dev-auth-registrar` | Issues OIDC clients to apps over Dex's gRPC API, on the isolated `dex-internal` network. |
| `caddy` | `dev-caddy` | `caddy-docker-proxy`; routes all three hostnames from container labels. |

## Where the template tree comes from

`pcs-host` **bind-mounts `../../../template-root/root`** and rsyncs it into
place, honouring `root/.ignore`. Edit a script in `packages/template-root` and
`docker compose restart pcs-host` picks it up — no commit, no push, no zip.

This replaced a `curl` of a GitHub zip, which meant the dev stack could never
show you an unpushed template change. `UPDATE_URL=local` in `.env` then stops
`ensure-template-sync.sh` from re-downloading over your working copy on a later
tick.

This step is load-bearing. `ensure-authelia.sh` from that tree writes Authelia's
secrets, JWKS, `configuration.yml` and `users_database.yml`; `ensure-dex.sh`
renders Dex's config and theme. If the sync fails, the `/tmp/bootstrap-ready`
marker is never written, the healthcheck never passes, and nothing else starts.

## What bootstrap.sh does

It deliberately does **not** run the full self-check loop — that would try to
apt-upgrade, resize partitions and configure swap inside a container, fail in
interesting ways, and tell you nothing about the app. Instead, in order:

1. rsync the template tree from the local checkout
2. write `.pcs.env` / `.pcs.secret.env` / `.ynd.user.env` from `.env`
3. mint the dev CA + server cert into the `certs` volume
4. `ensure-admin-user.sh` — the sudoer the dashboard SSHes in as
5. `ensure-authelia.sh` — secrets, JWKS, config, seeded `admin` account
6. `ensure-dex.sh` — config + login theme
7. copy the CA into Dex's data dir, mark ready, start sshd

Steps 5 and 6 are ordered: `ensure-authelia.sh` mints `AUTHELIA_DEX_SECRET`,
which `ensure-dex.sh` interpolates into the Local Account connector.

## Files

| File | Tracked | Purpose |
|---|---|---|
| `docker-compose.yml` | yes | Stack definition |
| `bootstrap.sh` | yes | PCS provisioning; bind-mounted, so edits need only a restart |
| `Dockerfile` | yes | Ubuntu base for `pcs-host` (sshd, openssl, docker CLI, yq) |
| `Dockerfile.admin-dev` | yes | Node base for `admin` with full deps for fast refresh |
| `Caddyfile` | yes | Dev variant of the prod Caddyfile |
| `.env.example` | yes | Copy to `.env` |
| `.env` | **no** (gitignored) | Local config |

## Common operations

```bash
docker compose logs -f admin              # app logs
docker compose logs pcs-host              # provisioning output
docker exec -it pcs-host bash             # shell into the simulated PCS

# Local accounts, straight from the host script the dashboard drives
docker exec pcs-host /DATA/AppData/casaos/apps/yundera/scripts/tools/authelia-user-manager.sh list

# Inspect the user store
docker exec pcs-host cat /DATA/AppData/yundera/auth/users_database.yml

# Pick up an edited template-root script
docker compose restart pcs-host

# Fresh slate
docker compose down -v && docker compose up -d --build
```

## Troubleshooting

**Nothing starts / healthcheck never passes.** `docker compose logs pcs-host`.
The bootstrap is fail-fast on a missing template mount or unset `DOMAIN`.

**Login loops, or `getDiscovery` ECONNREFUSED.** `dev-caddy` carries network
aliases for all three hostnames. Without them, server-side calls from `admin`
and `dex` fall through to public DNS — `*.localhost` resolves to `127.0.0.1`,
which is the calling container's own netns.

**Dex logs a TLS / x509 error against `local-auth-…`.** Dex reads
`SSL_CERT_FILE=/data/ca-bundle.crt`, which `bootstrap.sh` copies from `/certs`.
Confirm it exists: `docker exec dex ls -l /data/ca-bundle.crt`. This is why the
stack mints its own CA up front rather than using Caddy's `tls internal`, whose
CA is only created lazily — after Dex has already tried its connector.

**Ports 80/443 already in use.** `dev-caddy` publishes both.

**Admin sees only the Account panel.** That is the non-admin view — it means the
`groups` claim is not arriving, so `role` fell back to `user`. Check the
`admins` group is on your account (`authelia-user-manager.sh list`) and that
`dex.config.yaml.tmpl` still sets `insecureEnableGroups: true`.
