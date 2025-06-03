#!/bin/bash

set -e  # Exit on any error

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run as root. Please use sudo or run as root user."
    exit 1
fi

COMPOSE_FILE="/DATA/AppData/casaos/apps/yundera/docker-compose.yml"

docker compose -f "$COMPOSE_FILE" pull --quiet || {
    echo "ERROR: Failed to pull Docker images. Please check your network connection or Docker configuration." >> /DATA/AppData/casaos/apps/yundera/log/yundera.log
    exit 1
}

# Log successful execution
echo "=== os-docker-image-up-to-date.sh executed successfully ===" >> /DATA/AppData/casaos/apps/yundera/log/yundera.log