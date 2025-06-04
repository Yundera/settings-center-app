#!/bin/bash

set -e

export DEBIAN_FRONTEND=noninteractive

# Install and configure OpenSSH server

if [ -f /.dockerenv ]; then
    echo "Inside Docker - dev environment detected. Skipping setup."
    exit 42
fi

# Install openssh-server only if not already installed
dpkg-query -W openssh-server >/dev/null 2>&1 || apt-get install -qq -y openssh-server

# Enable and start SSH service
systemctl enable ssh.service
systemctl start ssh.service

# Reconfigure openssh-server
dpkg-reconfigure openssh-server