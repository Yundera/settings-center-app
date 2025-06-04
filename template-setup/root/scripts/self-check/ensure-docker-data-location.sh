#!/bin/bash
# this script is idempotent and can be run multiple times without issues
# Define Docker data root directory
DOCKER_DATA_ROOT="/DATA/AppData/docker"

# Configuration
DAEMON_JSON="/etc/docker/daemon.json"
DEFAULT_DOCKER_ROOT="/var/lib/docker"
BACKUP_SUFFIX=".backup.$(date +%Y%m%d_%H%M%S)"

# Logging functions
log_info() {
    echo "[INFO] $1"
}

log_warn() {
    echo "[WARN] $1"
}

log_error() {
    echo "[ERROR] $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
}

# Get current Docker data root from daemon
get_current_data_root() {
    if docker info &> /dev/null; then
        docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo "$DEFAULT_DOCKER_ROOT"
    else
        echo "$DEFAULT_DOCKER_ROOT"
    fi
}

# Check if daemon.json exists and parse current data-root
get_config_data_root() {
    if [[ -f "$DAEMON_JSON" ]]; then
        # Use jq if available, otherwise use grep/sed
        if command -v jq &> /dev/null; then
            jq -r '.["data-root"] // empty' "$DAEMON_JSON" 2>/dev/null
        else
            # Fallback parsing without jq
            grep -o '"data-root"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | \
            sed 's/.*"data-root"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
        fi
    fi
}

# Create or update daemon.json
update_daemon_json() {
    local target_root="$1"

    # Create docker config directory if it doesn't exist
    mkdir -p "$(dirname "$DAEMON_JSON")"

    if [[ -f "$DAEMON_JSON" ]]; then
        # Backup existing configuration
        cp "$DAEMON_JSON" "${DAEMON_JSON}${BACKUP_SUFFIX}"
        log_info "Backed up existing daemon.json to ${DAEMON_JSON}${BACKUP_SUFFIX}"

        if command -v jq &> /dev/null; then
            # Use jq to update the configuration
            jq --arg dataroot "$target_root" '.["data-root"] = $dataroot' "$DAEMON_JSON" > "${DAEMON_JSON}.tmp" && \
            mv "${DAEMON_JSON}.tmp" "$DAEMON_JSON"
        else
            # Fallback: manual JSON manipulation
            if grep -q '"data-root"' "$DAEMON_JSON"; then
                # Replace existing data-root
                sed -i "s|\"data-root\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"data-root\": \"$target_root\"|" "$DAEMON_JSON"
            else
                # Add data-root to existing JSON
                sed -i 's/{/{\n  "data-root": "'"$target_root"'",/' "$DAEMON_JSON"
            fi
        fi
    else
        # Create new daemon.json
        cat > "$DAEMON_JSON" << EOF
{
  "data-root": "$target_root"
}
EOF
        log_info "Created new daemon.json configuration"
    fi
}

# Stop Docker service
stop_docker() {
    log_info "Stopping Docker service..."
    if systemctl is-active --quiet docker; then
        systemctl stop docker
        # Wait for Docker to fully stop
        sleep 3
    fi
}

# Start Docker service
start_docker() {
    log_info "Starting Docker service..."
    systemctl start docker

    # Wait for Docker to start and verify
    local retries=10
    while [[ $retries -gt 0 ]]; do
        if docker info &> /dev/null; then
            log_info "Docker service started successfully"
            return 0
        fi
        sleep 2
        ((retries--))
    done

    log_error "Failed to start Docker service"
    return 1
}

# Move Docker data if needed
migrate_docker_data() {
    local current_root="$1"
    local target_root="$2"

    # Skip if source and target are the same
    if [[ "$current_root" == "$target_root" ]]; then
        log_info "Docker data is already in the target location"
        return 0
    fi

    # Skip if source doesn't exist
    if [[ ! -d "$current_root" ]]; then
        log_warn "Source directory $current_root doesn't exist, creating target directory"
        mkdir -p "$target_root"
        return 0
    fi

    # Create target directory
    mkdir -p "$target_root"

    # Check if target directory is empty
    if [[ -n "$(ls -A "$target_root" 2>/dev/null)" ]]; then
        log_warn "Target directory $target_root is not empty, skipping data migration"
        return 0
    fi

    log_info "Migrating Docker data from $current_root to $target_root..."

    # Use rsync if available, otherwise use cp
    if command -v rsync &> /dev/null; then
        rsync -aP "$current_root/" "$target_root/"
    else
        cp -rp "$current_root/"* "$target_root/" 2>/dev/null || true
    fi

    if [[ $? -eq 0 ]]; then
        log_info "Data migration completed successfully"
        # Optionally remove old directory (commented out for safety)
        # rm -rf "$current_root"
        log_warn "Old Docker data directory $current_root can be removed manually after verification"
    else
        log_error "Data migration failed"
        return 1
    fi
}

# Validate the new configuration
validate_configuration() {
    log_info "Validating Docker configuration..."

    local actual_root
    actual_root=$(get_current_data_root)

    if [[ "$actual_root" == "$DOCKER_DATA_ROOT" ]]; then
        log_info "✓ Docker data root successfully configured to: $actual_root"
        return 0
    else
        log_error "✗ Configuration validation failed. Expected: $DOCKER_DATA_ROOT, Actual: $actual_root"
        return 1
    fi
}

# Main execution
main() {
    log_info "Starting Docker data root configuration script..."
    log_info "Target Docker data root: $DOCKER_DATA_ROOT"

    # Pre-flight checks
    check_root
    check_docker

    # Get current configuration
    local current_data_root
    current_data_root=$(get_current_data_root)
    log_info "Current Docker data root: $current_data_root"

    local config_data_root
    config_data_root=$(get_config_data_root)

    # Check if configuration is already correct
    if [[ "$config_data_root" == "$DOCKER_DATA_ROOT" ]] && [[ "$current_data_root" == "$DOCKER_DATA_ROOT" ]]; then
        log_info "✓ Docker data root is already correctly configured"
        exit 0
    fi

    # Stop Docker before making changes
    stop_docker

    # Migrate data if needed (before updating config)
    if [[ "$current_data_root" != "$DOCKER_DATA_ROOT" ]]; then
        migrate_docker_data "$current_data_root" "$DOCKER_DATA_ROOT"
    fi

    # Update daemon.json configuration
    if [[ "$config_data_root" != "$DOCKER_DATA_ROOT" ]]; then
        log_info "Updating daemon.json configuration..."
        update_daemon_json "$DOCKER_DATA_ROOT"
    fi

    # Start Docker and validate
    if start_docker; then
        validate_configuration
        log_info "✓ Docker data root configuration completed successfully"
    else
        log_error "✗ Failed to restart Docker service"
        exit 1
    fi
}

# Execute main function
main "$@"