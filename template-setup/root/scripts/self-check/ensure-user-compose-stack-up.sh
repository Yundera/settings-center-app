#!/bin/bash
set -e

COMPOSE_FILE="/DATA/AppData/casaos/apps/yundera/docker-compose.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "ERROR: Docker compose file not found: $COMPOSE_FILE"
    exit 1
fi

echo "Starting docker compose update..."

# Run docker compose directly in background, streaming output
docker compose -f "$COMPOSE_FILE" up --quiet-pull -d &
DOCKER_PID=$!

echo "Docker compose started (PID: $DOCKER_PID)"

# Wait for completion and capture exit code
if wait $DOCKER_PID; then
    echo "User compose stack is up"
else
    echo "ERROR: Failed to start docker containers"
    exit $?
fi