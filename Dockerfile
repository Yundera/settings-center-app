# =============================================================================
# Stage 1: Dependencies (for build)
# =============================================================================
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY settings-dashboard/package.json ./settings-dashboard/
COPY dashboard-core/package.json ./dashboard-core/

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
COPY --from=deps /app/dashboard-core/node_modules ./dashboard-core/node_modules

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

# Install runtime dependencies
RUN apk add --no-cache iproute2 openssh-client

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files for production install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY settings-dashboard/package.json ./settings-dashboard/
COPY dashboard-core/package.json ./dashboard-core/

# Install production dependencies only (correct platform binaries, no dev deps)
RUN --mount=type=cache,id=pnpm-prod,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod && \
    # Remove wrong-platform binaries and unnecessary packages
    rm -rf node_modules/.pnpm/@next+swc-linux-x64-gnu* \
           node_modules/.pnpm/@next+swc-linux-arm64-gnu* \
           node_modules/.pnpm/typescript@*

# Copy built application
COPY --from=builder /app/settings-dashboard/.next ./settings-dashboard/.next
COPY --from=builder /app/settings-dashboard/public ./settings-dashboard/public
COPY --from=builder /app/settings-dashboard/src ./settings-dashboard/src
COPY --from=builder /app/settings-dashboard/server.ts ./settings-dashboard/server.ts
COPY --from=builder /app/settings-dashboard/tsconfig.json ./settings-dashboard/tsconfig.json
COPY --from=builder /app/settings-dashboard/config ./settings-dashboard/config

# Copy dashboard-core source (needed for transpilation at runtime)
COPY --from=builder /app/dashboard-core/src ./dashboard-core/src

# Copy template files
COPY --from=builder /app/dev/run/template-root/root/scripts /app/template-scripts

# Set environment
ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

EXPOSE 80

CMD ["pnpm", "-r", "prod"]
