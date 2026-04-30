#!/bin/bash
set -e

# Define variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_PATH="$SCRIPT_DIR/run"

# Detect docker compose command (plugin vs standalone)
if docker compose version &>/dev/null; then
    DOCKER_COMPOSE="docker compose"
elif docker-compose version &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "Error: Neither 'docker compose' nor 'docker-compose' found. Please install Docker Compose."
    exit 1
fi

# Change to the compose directory
cd "$COMPOSE_PATH"

echo "Starting Docker Compose services with clean environment..."

# Stop and remove existing containers and volumes for clean testing
echo "Cleaning up previous containers and volumes..."
$DOCKER_COMPOSE down -v || true

# Build and run the services
echo "Building and starting services..."
$DOCKER_COMPOSE up -d --build

if [ $? -ne 0 ]; then
    echo "Error: Docker Compose failed. Exiting."
    exit 1
fi

echo ""
echo "Main app available at: https://admin-127-0-0-1.nip.io  (accept the cert warning, or trust the Caddy local CA — see dev/run/README.md)"
echo "Environment started with clean volumes - migrations will run fresh"
echo "Remember to create a casaos user in the container if needed"
