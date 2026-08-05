# Simulated PCS host for the dev stack.
#
# Stands in for the Ubuntu VM a real PCS runs on: it holds the template-root
# tree, runs the provisioning scripts, and accepts SSH from the admin container
# (which is how the dashboard does everything privileged, including local-account
# management via `sudo -n authelia-user-manager.sh`).
FROM ubuntu:24.04

# - openssh-server : the dashboard's only channel to this host
# - openssl        : mints the dev CA + server cert in bootstrap.sh, and the
#                    OIDC JWKS key in ensure-authelia.sh
# - gettext-base   : envsubst, used to render both Authelia's and Dex's configs
# - rsync          : template tree sync, honouring root/.ignore
# - sudo           : ensure-admin-user.sh needs it; pre-installed so that script
#                    does not have to apt-get on every boot
# - util-linux     : flock, used by authelia-user-manager.sh to serialise
#                    read-modify-write against Authelia's own writes
# - curl/ca-certificates: yq download below, and optional operator-API calls
RUN apt-get update && apt-get install -y --no-install-recommends \
        openssh-server \
        openssl \
        gettext-base \
        rsync \
        sudo \
        util-linux \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI only — the host's daemon is reached through the mounted socket.
# The provisioning scripts shell out to `docker run authelia/authelia ...` to
# hash passwords and `docker restart <svc>` after re-rendering a config. Static
# binary rather than the `docker.io` package: no daemon we don't want, and a
# current API version (the packaged CLI is old enough to be refused by Engine 25+).
ARG DOCKER_VERSION=27.5.1
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) dl_arch=x86_64 ;; \
        arm64) dl_arch=aarch64 ;; \
        *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${dl_arch}/docker-${DOCKER_VERSION}.tgz" \
      | tar -xz -C /tmp; \
    install -m 0755 /tmp/docker/docker /usr/bin/docker; \
    rm -rf /tmp/docker; \
    docker --version

# yq — required by scripts/tools/authelia-user-manager.sh. On a real PCS
# ensure-common-tools-installed.sh fetches this during the self-check loop;
# the dev bootstrap skips that loop deliberately, so bake it in. Version matches
# what that script pins.
ARG YQ_VERSION=v4.44.1
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    curl -fsSL "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_${arch}" \
      -o /usr/local/bin/yq; \
    chmod +x /usr/local/bin/yq; \
    yq --version

# sshd: key-only, and the `admin` account is the one the dashboard uses.
# Password auth stays off exactly as lock-password-auth.sh leaves a real PCS.
RUN mkdir -p /run/sshd /root/.ssh \
    && chmod 700 /root/.ssh \
    && printf '%s\n' \
        'PermitRootLogin prohibit-password' \
        'PubkeyAuthentication yes' \
        'PasswordAuthentication no' \
        'KbdInteractiveAuthentication no' \
        'UsePAM no' \
        > /etc/ssh/sshd_config.d/99-dev.conf

# bootstrap.sh is bind-mounted at runtime so it can be edited without a rebuild.
CMD ["bash", "/opt/bootstrap.sh"]
