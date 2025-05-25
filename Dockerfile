ARG BASE_PATH=""

# Base image setup
FROM node:lts AS base
ARG BASE_PATH
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_PUBLIC_BASE_PATH=$BASE_PATH

RUN apt update && apt install -y iproute2

# install docker https://docs.docker.com/engine/install/ubuntu/
RUN curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh

#same version as the one in CasaOS-UI package.json
RUN corepack enable && corepack prepare pnpm@9.0.6 --activate

# pnpm file first
WORKDIR /app
COPY settings-dashboard/package.json /app/settings-dashboard/
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
