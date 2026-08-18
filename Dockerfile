# =============================================================================
# Stage 1: Dependencies (for build)
# =============================================================================
FROM node:20-alpine AS deps
# python3+make+g++ are needed to compile node-pty (native binding for the
# in-app web terminal) against musl.
RUN apk add --no-cache python3 make g++ linux-headers
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY settings-dashboard/package.json ./settings-dashboard/

# Install ALL dependencies (needed for build)
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# =============================================================================
# Stage 2: Builder
# =============================================================================
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate

ARG BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$BASE_PATH

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/settings-dashboard/node_modules ./settings-dashboard/node_modules

# Copy source code
COPY . .

# Build the application
RUN pnpm -r build

# Remove build cache and traces (saves ~600 MB)
RUN rm -rf settings-dashboard/.next/cache settings-dashboard/.next/trace

# =============================================================================
# Stage 3: Production Runner
# =============================================================================
FROM node:20-alpine AS runner

# Install runtime dependencies. python3+make+g++ are needed at install time
# to compile node-pty's native binding against musl in this stage's
# isolated --prod install (deps stage's binaries don't make it here).
# `curl` is used by the orchestrator's Path C trigger: it SSHes into the
# host and runs `docker exec admin curl … http://127.0.0.1:80/api/local/migration/start`
# to kick off the source-driven migration pipeline. Without curl in the
# admin image, the orchestrator's `docker exec` reports
# `OCI runtime exec failed: exec: "curl": executable file not found in $PATH`,
# the migrate-auto job fails with TRIGGER_FAILED, and the migration never
# reaches the source. See doc/architecture/migration.md (Path C).
# `tini` becomes PID 1 — see the ENTRYPOINT note at the bottom of this stage;
# without it this image leaks zombies until fork() stops working.
# No `iproute2`: it was added solely so detectHostIP could shell out to
# `ip route show default`, and that now parses /proc/net/route in-process
# (HostExecutor.ts). No code path here runs `ip` any more. Note busybox still
# provides a cut-down /sbin/ip, so the command has not disappeared from an
# interactive shell in this container — only the full iproute2 build has.
RUN apk add --no-cache tini openssh-client curl python3 make g++ linux-headers

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files for production install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY settings-dashboard/package.json ./settings-dashboard/

# Install production dependencies only (correct platform binaries, no dev deps)
RUN --mount=type=cache,id=pnpm-prod,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod && \
    # Remove wrong-platform binaries and unnecessary packages
    rm -rf node_modules/.pnpm/@next+swc-linux-x64-gnu* \
           node_modules/.pnpm/@next+swc-linux-arm64-gnu* \
           node_modules/.pnpm/typescript@*

# Drop the build toolchain now that node-pty is compiled — keeps the runner
# image lean.
RUN apk del python3 make g++ linux-headers

# Copy built application
COPY --from=builder /app/settings-dashboard/.next ./settings-dashboard/.next
COPY --from=builder /app/settings-dashboard/public ./settings-dashboard/public
COPY --from=builder /app/settings-dashboard/src ./settings-dashboard/src
COPY --from=builder /app/settings-dashboard/server.ts ./settings-dashboard/server.ts
COPY --from=builder /app/settings-dashboard/tsconfig.json ./settings-dashboard/tsconfig.json
COPY --from=builder /app/settings-dashboard/config ./settings-dashboard/config

# NOTE: no template-root copy here. The image used to bake
# dev/run/template-root/root/scripts into /app/template-scripts; nothing in the
# app ever read that path, and it froze a template-root submodule pin into every
# admin build. The scripts the app runs are the ones on the PCS itself, reached
# over SSH under COMPOSE_FOLDER_PATH. The dev/run/template-root submodule is
# gone too — the dev harness now downloads the template tree at container boot
# the way a real PCS does (see dev/run/docker-compose.yml).

# Set environment
ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

EXPOSE 80

# PID 1 MUST be a real init, not `pnpm`.
#
# This app reaches the host by shelling out to `ssh` (HostExecutor.ts), and ssh
# with ControlMaster/ControlPersist DAEMONIZES its multiplexing master through a
# double fork — by design, the intermediate forks and eventually the master
# itself are orphaned onto PID 1. A Node process (which is what `pnpm -r prod`
# is) never wait()s on children it did not spawn, so every one of those orphans
# became a permanent zombie holding a PID.
#
# Observed on a staging PCS: ~4 PIDs leaked per ControlPersist cycle, filling
# the container's 9483-entry pid cgroup in six days. After that every fork()
# returned EAGAIN, so each shell-out failed — surfacing as nonsense errors from
# whatever ran next — until Node itself could not spawn a thread and aborted
# (SIGABRT, exit 134). The restart cleared the zombies, which is why it looked
# intermittent on a weekly cycle rather than like a leak.
#
# tini reaps orphans, which makes the whole class of bug impossible regardless
# of what the app spawns. Keep this even if the ssh multiplexing options change.
#
# docker-entrypoint.sh is the node base image's own ENTRYPOINT, which this line
# replaces; it is chained here rather than dropped so `pnpm …` (and the dev
# harness's `command:` override) still resolve exactly as they did before.
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]

CMD ["pnpm", "-r", "prod"]
