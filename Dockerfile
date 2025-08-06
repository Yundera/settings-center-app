FROM node:lts AS base
ARG BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$BASE_PATH

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install corepack and enable it
RUN npm install -g corepack@latest && corepack enable

# Install useful tools
RUN apt-get update && apt-get install -y iproute2 && rm -rf /var/lib/apt/lists/*


# pnpm file first
WORKDIR /app
COPY settings-dashboard/package.json /app/settings-dashboard/
COPY dashboard-core/package.json /app/dashboard-core/
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/

# pnpm install
# Install the exact pnpm version specified in package.json
RUN corepack install
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY .eslintrc.json /app/.eslintrc.json
COPY ./dashboard-core /app/dashboard-core
COPY ./settings-dashboard /app/settings-dashboard

#recursive build
RUN pnpm -r build

#start the app
EXPOSE 4321

CMD ["pnpm", "-r", "prod"]

#docker build -t nextjs-test . && docker run -p 4321:4321 nextjs-test
