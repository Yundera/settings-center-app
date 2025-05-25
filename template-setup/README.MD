# Yundera

This folder contains the Yundera template system for Proxmox VM deployment, including scripts for template creation, instance initialization, and runtime management.

## Folder Structure

```
yundera/
├── README.MD                    # This file
└── root/                       # Files to be installed in /DATA/AppData/casaos/apps/yundera
    ├── .env                    # Environment configuration template
    ├── compose-template.yml    # Docker Compose template
    └── scripts/
        ├── template-init/      # Scripts for creating the VM template
        ├── os-init/           # Scripts for instance-specific initialization
        ├── self-check/        # Scripts for runtime monitoring and maintenance
        └── template-tool/     # Utility scripts for VM management
```

## Script Categories

### template-init/
Scripts used to create the Yundera template from a base Ubuntu OS installation. These scripts configure the VM for vertical scaling, install Docker, set up swap, and prepare the system for template conversion.

**Execution order:**
1. `os-init-scalable.sh` - Configure CPU/RAM hotplug support
2. `os-init-data-partition.sh` - Create resizable DATA partition using LVM
3. `os-init-docker.sh` - Install Docker and pull required images
4. `os-init-swap.sh` - Configure 4GB swap file
5. `os-init-tool.sh` - Install common utilities (htop, vim)
6. `os-init-self-check.sh` - Set up startup scripts
7. `os-init-cleanup.sh` - Clean system for template conversion (run last)

### os-init/
Scripts for one-time initialization specific to each VM instance after cloning from template.

- `lock-password-auth.sh` - Disable SSH password authentication, enforce key-based auth only

### self-check/
Scripts meant to run at startup and periodically for system maintenance.

- `docker-compose-run.sh` - Process environment variables and start Docker containers
- `extend-data-partition.sh` - Automatically extend DATA partition when disk is expanded
- `file-integrity-check.sh` - Generate docker-compose.yml from template using .env variables

### template-tool/
Utility scripts for VM diagnostics and management.

- `disk-benchmark.sh` - Perform comprehensive disk performance testing using fio

## Template Features

The Yundera template provides:

- **Vertical Scaling**: Support for CPU and RAM hotplug in Proxmox
- **Docker Environment**: Pre-installed Docker with required container images
- **Auto-expanding Storage**: LVM-based DATA partition that grows with disk expansion
- **Optimized Configuration**: Swap configuration and system tools
- **Container Orchestration**: CasaOS, admin interface, and mesh-router services

## Configuration Files

- **`.env`**: Environment variables template (customize with domain, credentials, etc.)
- **`compose-template.yml`**: Docker Compose template with placeholder variables

## Usage Context

This folder is designed to be:
1. Used during VM template creation (template-init scripts)
2. Deployed to `/DATA/AppData/casaos/apps/yundera` on each VM instance
3. Utilized for ongoing system maintenance and container management

## Requirements

- Proxmox VE environment
- Base Ubuntu 22.04 LTS Server installation
- Sufficient disk space for Docker images and data storage
- Internet connectivity for package installation