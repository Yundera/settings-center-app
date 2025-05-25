#!/bin/bash
#this script is the required setup for a fresh install of Ubuntu 22.04 LTS to create the yundera template

sudo apt-get update
sudo apt-get upgrade -y

# Install Docker
# https://docs.docker.com/engine/install/ubuntu/
# Add Docker's official GPG key:
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER

#sudo docker run hello-world
sudo docker version
sudo docker compose version

# docker pull initial casaos and mesh-router
sudo docker pull nasselle/mesh-router
sudo docker pull nasselle/casa-img
sudo docker pull nasselle/settings-center-app


# Log successful execution
echo "$(date): os-init-docker executed successfully" >> "/DATA/AppData/casaos/apps/yundera/yundera.log"