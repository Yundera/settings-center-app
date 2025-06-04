#!/bin/bash
# Script to ensure common tools are installed
export DEBIAN_FRONTEND=noninteractive

apt-get install -qq -y htop vim

echo "Common tools are installed"