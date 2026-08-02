FROM ubuntu:latest

# Install packages
# - openssh-server: ssh daemon for the simulated PCS
# - openssl, gettext-base (envsubst): used by ensure-auth-secrets.sh
# - docker.io: CLI only (we mount the host's docker.sock); ensure-auth-secrets.sh
#   and register-oidc-client.sh shell out to `docker run authelia/authelia ...`
#   to argon2-hash passwords + secrets, and `docker restart authelia` after re-render.
# - docker-compose-v2: provides the `docker compose` subcommand used by
#   ensure-user-compose-pulled.sh. Ubuntu 24.04's docker.io package no longer
#   bundles the compose plugin, so install it explicitly.
# - curl/unzip/rsync: the template-root bootstrap in docker-compose.yml fetches
#   and unpacks the template zip the same way a real PCS does in pcs-init.sh
#   (curl -> unzip -> rsync --exclude-from=.ignore). This replaces the former
#   dev/run/template-root submodule bind-mount.
RUN apt-get update && apt-get install -y --no-install-recommends \
        openssh-server \
        openssl \
        gettext-base \
        docker.io \
        docker-compose-v2 \
        ca-certificates \
        curl \
        unzip \
        rsync \
    && rm -rf /var/lib/apt/lists/*

# configure ssh as expected in a PCS
RUN mkdir -p /root/.ssh \
    && chmod 700 /root/.ssh \
    && echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config \
    && mkdir -p /run/sshd \
    && chmod 600 /root/.ssh/authorized_keys 2>/dev/null || true
