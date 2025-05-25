#!/bin/bash

echo "Installing commonly used packages"
apt update
apt install -y htop vim

# Log successful execution
echo "$(date): os-init-tool executed successfully" >> "/DATA/AppData/casaos/apps/yundera/yundera.log"