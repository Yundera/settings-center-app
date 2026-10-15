# syntax=docker/dockerfile:1

# 1) Build the Svelte UI -> internal/ui/dist
FROM node:22-slim AS ui
WORKDIR /src/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build   # writes to /src/internal/ui/dist

# 2) Build the Go binary with the UI embedded
FROM golang:1.25-alpine AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY --from=ui /src/internal/ui/dist ./internal/ui/dist
ARG BUILD_VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags="-s -w -X github.com/yundera/settings-center-app/internal/server.Version=${BUILD_VERSION}" \
      -o /yundera-admin ./cmd/yundera-admin

# 3) Runtime. The same image is also the host-verb runner (internal/hostrun):
#    util-linux-misc provides the nsenter it starts with. Everything a verb runs
#    after that is the HOST's (bash, ip, ssh-keygen, curl, dd), not this image's.
#    tzdata so self-check log timestamps parse in the host's zone (the template
#    mounts /etc/localtime); ca-certificates for the Yundera control plane.
#    No init: the binary spawns no children, so there is nothing to reap.
FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata util-linux-misc
COPY --from=backend /yundera-admin /yundera-admin
EXPOSE 80
ENTRYPOINT ["/yundera-admin"]
