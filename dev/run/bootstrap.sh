#!/bin/bash
# Dev-stack bootstrap for the simulated PCS host (`pcs-host` service).
#
# Stands in for what the orchestrator + first self-check tick do on a real PCS,
# but only the parts the dashboard actually needs. It deliberately does NOT run
# the full self-check loop: that would try to apt-upgrade, resize partitions and
# configure swap inside a container, fail in interesting ways, and tell you
# nothing about the app you are trying to look at. The scripts invoked here are
# the real ones from template-root — no dev forks.
#
# Runs as root inside the pcs-host container. Idempotent: safe to re-run, and
# re-run automatically on every `docker compose up`.

set -euo pipefail

YND_ROOT="/DATA/AppData/casaos/apps/yundera"
TEMPLATE_SRC="/tmp/template-src"          # bind-mount of packages/template-root/root
CERTS="/certs"                            # shared with caddy + dex
READY_MARKER="/tmp/bootstrap-ready"

log() { echo "[bootstrap] $*"; }

rm -f "$READY_MARKER"

# ---------------------------------------------------------------------------
# 1. Lay down the template tree from the LOCAL working copy.
#
# The previous harness curled a zip from GitHub, which meant the dev stack could
# never show you an unpushed template change — the exact thing you most want to
# test. We rsync the sibling checkout instead, honouring root/.ignore the same
# way ensure-template-sync.sh does.
# ---------------------------------------------------------------------------
if [ ! -d "$TEMPLATE_SRC" ]; then
    echo "[bootstrap] FATAL: $TEMPLATE_SRC is not mounted." >&2
    echo "            Expected a bind-mount of packages/template-root/root." >&2
    exit 1
fi

log "syncing template-root from local checkout"
mkdir -p "$YND_ROOT"
if [ -f "$TEMPLATE_SRC/.ignore" ]; then
    rsync -a --exclude-from="$TEMPLATE_SRC/.ignore" "$TEMPLATE_SRC/" "$YND_ROOT/"
else
    rsync -a "$TEMPLATE_SRC/" "$YND_ROOT/"
fi
find "$YND_ROOT/scripts" -name '*.sh' -exec chmod +x {} +

# ---------------------------------------------------------------------------
# 2. Env files. The template scripts `set -a; source` each of these
#    independently, so handing all three the same merged file is harmless —
#    every variable ends up in the environment either way.
# ---------------------------------------------------------------------------
log "writing .pcs.env / .pcs.secret.env / .ynd.user.env"
for f in .pcs.env .pcs.secret.env .ynd.user.env; do
    cp /tmp/dev.env "$YND_ROOT/$f"
    chmod 600 "$YND_ROOT/$f"
done

DOMAIN="$("$YND_ROOT/scripts/tools/env-file-manager.sh" get DOMAIN "$YND_ROOT/.ynd.user.env")"
[ -n "$DOMAIN" ] || { echo "[bootstrap] FATAL: DOMAIN unset in .env" >&2; exit 1; }
log "DOMAIN=$DOMAIN"

# ---------------------------------------------------------------------------
# 3. TLS. Caddy uses a cert we mint here rather than `tls internal`.
#
# Not cosmetic: Dex opens a BACK-CHANNEL to Authelia's issuer over HTTPS
# (discovery, token exchange, userinfo) and must trust whoever signed it.
# Caddy's `tls internal` CA is generated lazily on first issuance, which is
# after Dex has already started — so Dex would fail its connector on a cold
# boot and there is no ordering that fixes it. Minting the CA here instead
# makes it available before any dependent starts, and it matches prod more
# closely anyway (prod Caddy serves a mounted gateway cert, not an internal one).
#
# Trust /certs/ca.pem in your browser once to lose the warning page.
# ---------------------------------------------------------------------------
mkdir -p "$CERTS"
if [ ! -f "$CERTS/ca.pem" ] || [ ! -f "$CERTS/cert.pem" ]; then
    log "minting dev CA + server certificate for *.${DOMAIN#*.} and ${DOMAIN}"

    openssl genrsa -out "$CERTS/ca.key" 4096 2>/dev/null
    openssl req -x509 -new -nodes -key "$CERTS/ca.key" -sha256 -days 3650 \
        -subj "/CN=Yundera Dev CA/O=Yundera Dev" -out "$CERTS/ca.pem" 2>/dev/null

    # DOMAIN is `dev.localhost`, and services are published as SIBLINGS of it
    # (`admin-dev.localhost`), not subdomains — so a `*.dev.localhost` wildcard
    # would not match. Enumerate the real hostnames, plus a `*.localhost`
    # wildcard so extra services need no cert regeneration.
    cat > "$CERTS/san.cnf" <<EOF
[req]
distinguished_name = dn
[dn]
[ext]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
[alt]
DNS.1 = ${DOMAIN}
DNS.2 = admin-${DOMAIN}
DNS.3 = auth-${DOMAIN}
DNS.4 = local-auth-${DOMAIN}
DNS.5 = *.${DOMAIN}
DNS.6 = *.localhost
DNS.7 = localhost
IP.1 = 127.0.0.1
EOF

    openssl genrsa -out "$CERTS/key.pem" 2048 2>/dev/null
    openssl req -new -key "$CERTS/key.pem" -subj "/CN=${DOMAIN}" -out "$CERTS/csr.pem" 2>/dev/null
    openssl x509 -req -in "$CERTS/csr.pem" -CA "$CERTS/ca.pem" -CAkey "$CERTS/ca.key" \
        -CAcreateserial -out "$CERTS/cert.pem" -days 3650 -sha256 \
        -extfile "$CERTS/san.cnf" -extensions ext 2>/dev/null
    rm -f "$CERTS/csr.pem"

    # Caddy and Dex run as non-root; both only ever read these.
    chmod 644 "$CERTS/ca.pem" "$CERTS/cert.pem"
    chmod 644 "$CERTS/key.pem"
    log "certificates written to $CERTS"
else
    log "certificates already present, reusing"
fi

# ---------------------------------------------------------------------------
# 4. The `admin` sudoer. This is the account the dashboard SSHes in as, and the
#    one `sudo -n authelia-user-manager.sh ...` runs under.
# ---------------------------------------------------------------------------
log "ensuring admin user"
bash "$YND_ROOT/scripts/self-check/ensure-admin-user.sh"

# The ssh_keys volume is mounted at /home/admin/.ssh and starts root-owned and
# empty, which sshd's StrictModes rejects. The admin container writes its
# generated pubkey in here on first connect.
mkdir -p /home/admin/.ssh
touch /home/admin/.ssh/authorized_keys
chown -R admin:admin /home/admin
chmod 700 /home/admin/.ssh
chmod 600 /home/admin/.ssh/authorized_keys

# The dashboard runs `docker ps` (and friends) over SSH as `admin`, unelevated —
# see DockerUpdate.ts / docker-ps.ts. On a real PCS the socket is group-readable
# by a `docker` group that admin belongs to; here the socket is bind-mounted from
# the host and arrives owned by whatever GID the host uses, so admin gets
# "permission denied" and the Health / containers panels 500. Add admin to a
# group matching the socket's actual GID.
#
# On Docker Desktop / WSL2 that GID is often 0, so admin ends up in `root`. That
# is not an escalation here — admin already holds NOPASSWD:ALL sudo on this
# simulated host — but it is a dev-only shortcut and should not be copied into
# anything that provisions a real PCS.
if [ -S /var/run/docker.sock ]; then
    SOCK_GID="$(stat -c '%g' /var/run/docker.sock)"
    SOCK_GROUP="$(getent group "$SOCK_GID" | cut -d: -f1 || true)"
    if [ -z "$SOCK_GROUP" ]; then
        SOCK_GROUP=dockersock
        groupadd -g "$SOCK_GID" "$SOCK_GROUP" 2>/dev/null || true
    fi
    usermod -aG "$SOCK_GROUP" admin
    log "admin added to '$SOCK_GROUP' (gid $SOCK_GID) for docker socket access"
fi

# ---------------------------------------------------------------------------
# 5. Authelia, then Dex — order matters. ensure-authelia.sh mints
#    AUTHELIA_DEX_SECRET into .pcs.secret.env, and ensure-dex.sh interpolates it
#    into the Local Account connector. Both no-op their `docker restart` when
#    the container is not up yet, which is the case on a cold boot.
# ---------------------------------------------------------------------------
log "provisioning Authelia (secrets, JWKS, config, admin user)"
bash "$YND_ROOT/scripts/self-check/ensure-authelia.sh"

log "provisioning Dex (config, theme)"
bash "$YND_ROOT/scripts/self-check/ensure-dex.sh"

# Dex reads SSL_CERT_FILE=/data/ca-bundle.crt (see docker-compose.yml). /data is
# the dex volume that ensure-dex.sh just populated, so drop the CA in beside the
# config. This is the escape hatch the prod compose documents for connectors
# whose issuer is not publicly trusted.
cp -f "$CERTS/ca.pem" /DATA/AppData/yundera/dex/ca-bundle.crt
chmod 644 /DATA/AppData/yundera/dex/ca-bundle.crt

# ---------------------------------------------------------------------------
# 6. Ready.
# ---------------------------------------------------------------------------
touch "$READY_MARKER"
log "ready — starting sshd"

mkdir -p /run/sshd
/usr/sbin/sshd -D -e
