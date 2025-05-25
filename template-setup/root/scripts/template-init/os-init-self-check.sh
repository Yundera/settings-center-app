#!/bin/bash

# Define the remote folder path
remoteFolder="/DATA/AppData/casaos/apps/yundera"

# Add @reboot cron job for start.sh script
# This removes any existing entry for this script and adds a new one
(crontab -l 2>/dev/null || echo "") | grep -v "$remoteFolder/start.sh" | { cat; echo "@reboot $remoteFolder/start.sh"; } | crontab -

# Log successful execution
echo "$(date): os-init-self-check executed successfully" >> "$remoteFolder/yundera.log"