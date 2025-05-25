#!/bin/bash

# Define paths
SCRIPT_DIR="/DATA/AppData/casaos/apps/yundera/scripts/self-check"
LOG_FILE="/DATA/AppData/casaos/apps/yundera/yundera.log"

# Function to log with timestamp
log() {
    echo "$(date): $1" >> "$LOG_FILE"
}

log "=== Starting Yundera deployment ==="

# 1. Extend partition
log "Extending DATA partition..."
if ! $SCRIPT_DIR/extend-data-partition.sh; then
    log "ERROR: Failed to extend partition"
    exit 1
fi

# 2. Generate docker-compose.yml
log "Generating docker-compose.yml..."
if ! $SCRIPT_DIR/file-integrity-check.sh; then
    log "ERROR: Failed to generate docker-compose.yml"
    exit 1
fi

# 3. Start containers
log "Starting Docker containers..."
if ! $SCRIPT_DIR/docker-compose-run.sh; then
    log "ERROR: Failed to start containers"
    exit 1
fi

log "=== Self-check completed successfully ==="