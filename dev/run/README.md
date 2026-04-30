# Development Environment

Docker-based dev stack for the Settings Center App in a simulated Personal Cloud Server (PCS), behind the same OIDC stack the prod template ships.

All services route through a local Caddy on `*.dev.localhost` (which all modern browsers resolve to `127.0.0.1` per RFC 6761), so no `/etc/hosts` edits are needed and the `<container>-${DOMAIN}` URL shape that mesh-router-auth's redirect-URI validation expects is preserved.

## Services

| Service | Role |
|---|---|
| `admin` | Settings Center App under test. Container name is `admin` so mesh-router-auth's PTR-derived clientId matches the prod template. |
| `ubuntu-host-pcs` | Simulated PCS host. Runs template-root self-checks and bootstraps Authelia secrets/JWKS into the shared `auth_data` volume. |
| `authelia` | OIDC IdP (Authelia 4.39), configured by `ensure-auth-secrets.sh`. |
| `dev-auth-registrar` | `mesh-auth` sidecar that hands out OIDC client credentials via `POST /register`. |
| `dev-caddy` | `caddy-docker-proxy` routing `admin-${DOMAIN}` and `auth-${DOMAIN}` from container labels with `tls internal` certs. |

## Quick Start

```bash
cp .env.example .env
# edit .env — fill in UID, USER_JWT, DEFAULT_PWD, PROVIDER_STR, EMAIL
docker compose up -d --build
```

Open `https://admin-dev.localhost/`. First request triggers an OIDC redirect through Authelia. Default Authelia admin user is `admin` / `$DEFAULT_PWD` from `.env`.

### One-time: trust Caddy's local CA

`tls internal` mints certs from a per-Caddy local CA. Until you trust it, every browser tab will warn (and `curl` needs `-k`).

```bash
docker compose cp dev-caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
# Linux: sudo cp caddy-root.crt /usr/local/share/ca-certificates/dev-caddy.crt && sudo update-ca-certificates
# macOS: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain caddy-root.crt
# Or just click through — the browser remembers per-domain.
```

## Files

| File | Tracked | Purpose |
|---|---|---|
| `docker-compose.yml` | yes | Stack definition |
| `Dockerfile` | yes | Ubuntu base for `ubuntu-host-pcs` (sshd, openssl, docker CLI) |
| `Dockerfile.admin-dev` | yes | Node base for the `admin` service with full deps for Next.js fast refresh |
| `Caddyfile` | yes | Dev variant of the prod template Caddyfile (uses `tls internal` instead of mounted certs) |
| `template-root/` | yes (submodule) | Bind-mounted into `ubuntu-host-pcs` to simulate the prod PCS template |
| `.env.example` | yes | Template — copy to `.env` and fill in |
| `.env` | **no** (gitignored) | Local secrets: UID, JWT, password, provider sig |

The single `.env` is consumed twice: Compose substitutes `${DOMAIN}` etc. into labels at render time (auto-loaded from this directory), and the `admin` container loads it via `env_file:`. For `ubuntu-host-pcs`, the same file is mounted at `/tmp/.env` and copied into the data volume under all three names the inner template-root scripts expect (`.pcs.env`, `.pcs.secret.env`, `.ynd.user.env`) — they each grep the keys they care about, so receiving a superset is fine.

## Common Operations

```bash
# Tail logs
docker compose logs -f admin

# Shell into the simulated PCS
docker exec -it ubuntu-host-pcs bash

# Re-run a self-check manually
docker exec ubuntu-host-pcs bash /DATA/AppData/casaos/apps/yundera/scripts/self-check/ensure-template-sync.sh

# Inspect the staged env files inside the PCS
docker exec ubuntu-host-pcs cat /DATA/AppData/casaos/apps/yundera/.ynd.user.env

# Fresh start — wipe volumes and rebuild
docker compose down -v
docker compose up -d --build
```

## Troubleshooting

**Container won't start** — check ports 80/443 are free (dev-caddy publishes them) and Docker is running. If state looks bad: `docker compose down -v`.

**SSH-from-admin to host fails** — both containers must be up: `docker ps`. Check sshd: `docker exec ubuntu-host-pcs service ssh status`. Both share the `ssh_keys` volume.

**OIDC redirect loops or `getDiscovery` ECONNREFUSED** — verify `dev-caddy` has the `admin-${DOMAIN}` and `auth-${DOMAIN}` aliases on `app-network` (it does, via the `aliases:` block in `docker-compose.yml`). Without those, the admin container's server-side OIDC calls fall back to public DNS, which returns `127.0.0.1` and hits its own netns.

**Authelia won't start / config missing** — `ensure-auth-secrets.sh` runs on `ubuntu-host-pcs` startup and writes secrets+JWKS+`configuration.yml`+`users_database.yml` into the shared `auth_data` volume. Authelia's `depends_on: ubuntu-host-pcs (healthy)` gates on the `/tmp/auth-bootstrap-ready` marker, so if Authelia is failing, check the bootstrap script ran:
```bash
docker compose logs ubuntu-host-pcs | grep -i auth
docker exec ubuntu-host-pcs ls -la /DATA/AppData/yundera/auth/
```
