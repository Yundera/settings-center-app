ARG BASE_PATH=/dashboard

# Base image setup
FROM node:lts-slim AS base
ARG BASE_PATH
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_PUBLIC_BASE_PATH=$BASE_PATH

RUN corepack enable

# pnpm file first
WORKDIR /app
COPY mesh-dashboard/package.json /app/vnas-dashboard/
COPY dashboard-core/package.json /app/dashboard-core/
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/

# pnpm install
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . /app/

#recursive build
RUN pnpm -r build

#start the app
EXPOSE 4321
CMD ["pnpm", "-r", "prod"]

#docker build -t nextjs-test . && docker run -p 4321:4321 nextjs-test
