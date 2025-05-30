#!/bin/bash

# Yundera Self-Check Script
# Ensures system is properly configured for Yundera application

# Configuration
SCRIPT_DIR="/DATA/AppData/casaos/apps/yundera/scripts/self-check"
LOG_FILE="/DATA/AppData/casaos/apps/yundera/yundera.log"

# Logging function with timestamp
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" >> "$LOG_FILE"
}

# Error handling function
handle_error() {
    log "ERROR: $1"
    log "=== Self-check failed ==="
    exit 1
}

log "=== Starting final user hand over ==="

# run some self-check scripts
../self-check-admin/ensure-pcs-user.sh

../self-check-admin/ensure-common-tools-installed.sh

../self-check/ensure-self-check-at-reboot.sh

../self-check/ensure-docker-installed.sh

../self-check-admin/ensure-vm-scalable.sh

../self-check-admin/ensure-data-partition-size.sh

../self-check-admin/ensure-swap.sh

# Configure reboot settings
log "Configuring access..."
if ! "$SCRIPT_DIR/lock-password-auth"; then
    handle_error "Failed to configure password authentication settings"
fi
log "Access settings configured successfully"

# System cleanup
log "Performing system cleanup..."
if ! "$SCRIPT_DIR/os-cleanup-before-use.sh"; then
    handle_error "Failed to complete system cleanup"
fi
log "System cleanup completed successfully"

log "=== Final user hand over completed successfully ==="