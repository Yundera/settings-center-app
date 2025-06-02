#!/bin/bash
# Ensures system is properly configured

set -e

SCRIPT_DIR="/DATA/AppData/casaos/apps/yundera/scripts"
source ${SCRIPT_DIR}/library/common.sh

log "=== Starting final user hand over ==="

# run self-check scripts
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-pcs-user.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-ubuntu-up-to-date.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-common-tools-installed.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-ssh.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-vm-scalable.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-qemu-agent.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-data-partition.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-data-partition-size.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-swap.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-self-check-at-reboot.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-docker-installed.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-user-docker-compose-updated.sh
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-user-compose-stack-up.sh


# run os-init scripts
execute_script_with_logging $SCRIPT_DIR/os-init/lock-password-auth.sh
execute_script_with_logging $SCRIPT_DIR/os-init/os-cleanup-before-use.sh

log "=== Final user hand over completed successfully ==="