#!/bin/bash

#These scripts ensure VM basic functionalities.
#Basic functionalities are:
#1. Connectivity of the VM (VM should be accessible to the user in all cases)
#2. Docker and the admin dev stack should always be up and running
#3. The self-check script should always ensure these 3 points

set -e

SCRIPT_DIR="/DATA/AppData/casaos/apps/yundera/scripts"
source ${SCRIPT_DIR}/library/common.sh

log "=== Self-check-os starting  ==="

execute_script_with_logging $SCRIPT_DIR/self-check/ensure-self-check-at-reboot.sh;
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-docker-installed.sh;
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-user-docker-compose-updated.sh;
execute_script_with_logging $SCRIPT_DIR/self-check/ensure-user-compose-stack-up.sh

log "=== Self-check-os completed successfully ==="