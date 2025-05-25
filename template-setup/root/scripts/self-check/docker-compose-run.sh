#!/bin/bash

COMPOSE_FILE=/DATA/AppData/casaos/apps/yundera/docker-compose.yml

# Check if docker compose is installed
if ! command -v docker compose &> /dev/null; then
    echo "Error: docker compose is not installed or not in PATH"
    exit 1
fi

# Execute docker compose down with error suppression before bringing containers up
echo "Stopping any existing containers..."
docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true

# Execute docker compose up -d on the generated file with reduced output
echo "Starting containers with docker compose..."
# Redirect stdout to /dev/null but keep stderr to capture errors
if ! docker compose -f "$COMPOSE_FILE" up --quiet-pull -d; then
    echo "Error: Failed to start docker containers"
    exit 1
fi

echo "Docker containers successfully started"

