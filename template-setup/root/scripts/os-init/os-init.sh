#!/bin/bash
# Ensures system is properly configured

set -e

SCRIPT_DIR="/DATA/AppData/casaos/apps/yundera/scripts"
source ${SCRIPT_DIR}/library/common.sh

log "=== Starting final user hand over ==="

# basic permission and execution setup
chmod +x $SCRIPT_DIR/self-check/ensure-pcs-user.sh
chmod +x $SCRIPT_DIR/tools/make-executable.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-pcs-user.sh
execute_script_with_logging $SCRIPT_DIR/tools/make-executable.sh

# run small subset self-check scripts the entire subset will be run by the admin app
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-data-partition.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-data-partition-size.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-self-check-at-reboot.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-docker-installed.sh

# this will generate the user specific docker compose file with user specific settings
# and run the initial start of the docker compose user stack
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-user-docker-compose-updated.sh
execute_script_with_logging $SCRIPT_DIR/os-init/os-docker-image-up-to-date.sh
execute_script_with_logging $SCRIPT_DIR/tools/restart-user-compose-stack.sh

# run os-init scripts only once in the VM lifecycle
execute_script_with_logging $SCRIPT_DIR/os-init/lock-password-auth.sh
execute_script_with_logging $SCRIPT_DIR/os-init/os-cleanup-before-use.sh

log "=== Final user hand over completed successfully ==="