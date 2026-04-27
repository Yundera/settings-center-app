FROM ubuntu:latest

# Install packages
# - openssh-server: ssh daemon for the simulated PCS
# - openssl, gettext-base (envsubst): used by ensure-auth-secrets.sh
# - docker.io: CLI only (we mount the host's docker.sock); ensure-auth-secrets.sh
#   and register-oidc-client.sh shell out to `docker run authelia/authelia ...`
#   to argon2-hash passwords + secrets, and `docker restart authelia` after re-render.
RUN apt-get update && apt-get install -y --no-install-recommends \
        openssh-server \
        openssl \
        gettext-base \
        docker.io \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# configure ssh as expected in a PCS
RUN mkdir -p /root/.ssh \
    && chmod 700 /root/.ssh \
    && echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config \
    && mkdir -p /run/sshd \
    && chmod 600 /root/.ssh/authorized_keys 2>/dev/null || true
