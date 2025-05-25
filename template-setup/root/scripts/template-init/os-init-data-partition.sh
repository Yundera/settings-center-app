#!/bin/bash

# Script to create a resizable partition and mount it on /DATA
# This script must be run as root

# Exit immediately if a command exits with a non-zero status
set -e

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run as root" >&2
    exit 1
fi

# Fix the GPT to use all available space
echo "Fixing GPT to use all available space..."
sgdisk --resize-table=128 /dev/sda

# Fix the GPT to recognize the full disk
echo "Ensuring GPT recognizes full disk space..."
sgdisk -e /dev/sda

# Find the largest free space block on the disk
echo "Identifying largest free space on disk..."
# Get the free space info
FREE_SPACE_INFO=$(parted -s /dev/sda unit MB print free | grep "Free Space" | awk '{print $1, $2, $3}')

# Find the largest free space block
LARGEST_SIZE=0
LARGEST_START=""
LARGEST_END=""

while read -r START END SIZE; do
    # Extract just the number from the size (remove 'MB')
    SIZE_NUM=$(echo "$SIZE" | sed 's/MB//')

    if (( $(echo "$SIZE_NUM > $LARGEST_SIZE" | bc -l) )); then
        LARGEST_SIZE=$SIZE_NUM
        LARGEST_START=$START
        LARGEST_END=$END
    fi
done <<< "$FREE_SPACE_INFO"

if [ -z "$LARGEST_START" ] || [ "$LARGEST_SIZE" -lt 10 ]; then
    echo "No suitable free space found (minimum 10MB required)"
    exit 1
fi

echo "Found free space of ${LARGEST_SIZE}MB from ${LARGEST_START} to ${LARGEST_END}"

# Determine the next partition number
NEXT_PART_NUM=$(sgdisk -p /dev/sda | grep -c "^[ ]*[0-9]")
NEXT_PART_NUM=$((NEXT_PART_NUM + 1))
NEW_PARTITION="/dev/sda${NEXT_PART_NUM}"

echo "Will create partition: $NEW_PARTITION"

# Create a new partition in the largest free space
echo "Creating new partition in largest free space..."
parted -s /dev/sda unit MB mkpart primary ${LARGEST_START} ${LARGEST_END}

# Update kernel to see the new partition
partprobe /dev/sda

# Smart wait for the partition to become available
echo "Waiting for system to recognize new partition..."
TIMEOUT=30
COUNTER=0
while [ ! -b "$NEW_PARTITION" ] && [ $COUNTER -lt $TIMEOUT ]; do
    echo "Waiting for $NEW_PARTITION to appear... ($COUNTER/$TIMEOUT seconds)"
    sleep 1
    COUNTER=$((COUNTER + 1))
    # Force kernel to re-read partition table again
    if [ $((COUNTER % 5)) -eq 0 ]; then
        partprobe /dev/sda
        udevadm trigger
    fi
done

# Make sure the partition exists before continuing
if [ ! -b "$NEW_PARTITION" ]; then
    echo "Error: $NEW_PARTITION not found after $TIMEOUT seconds. Aborting."
    exit 1
fi

echo "New partition created: $NEW_PARTITION"
echo "Partition size: $(lsblk -no SIZE $NEW_PARTITION || echo "Unknown")"

# Create physical volume on the new partition
echo "Creating LVM physical volume..."
pvcreate $NEW_PARTITION || { echo "Failed to create physical volume"; exit 1; }

# Create a new volume group for DATA
echo "Creating volume group data_vg..."
vgcreate data_vg $NEW_PARTITION || { echo "Failed to create volume group"; exit 1; }

# Create a logical volume using 100% of the volume group
echo "Creating logical volume data_lv..."
lvcreate -l 100%FREE -n data_lv data_vg || { echo "Failed to create logical volume"; exit 1; }

# Format the logical volume with ext4
echo "Formatting logical volume with ext4..."
mkfs.ext4 /dev/data_vg/data_lv || { echo "Failed to format logical volume"; exit 1; }

# Create mount point if it doesn't exist
if [ ! -d "/DATA" ]; then
    echo "Creating mount point /DATA..."
    mkdir /DATA
fi

# Mount the volume
echo "Mounting volume to /DATA..."
mount /dev/data_vg/data_lv /DATA || { echo "Failed to mount volume"; exit 1; }

# Add entry to /etc/fstab for persistent mounting
echo "Updating /etc/fstab..."
echo "/dev/data_vg/data_lv /DATA ext4 defaults 0 2" >> /etc/fstab

mkdir -p /DATA/AppData/casaos/apps/yundera

# Change ownership of /DATA to ubuntu user
echo "Changing ownership of /DATA to ubuntu user..."
chown -R ubuntu:ubuntu /DATA || { echo "Failed to change ownership to ubuntu"; exit 1; }

# Log successful execution
echo "$(date): os-init-data-partition executed successfully" >> "/DATA/AppData/casaos/apps/yundera/yundera.log"

# Ensure the log file is also owned by ubuntu
chown ubuntu:ubuntu "/DATA/AppData/casaos/apps/yundera/yundera.log"

echo "Setup complete. New DATA partition mounted at /DATA and owned by ubuntu user"