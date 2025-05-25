#!/bin/bash

# Script to automatically extend the DATA partition when more disk space is available
# This script must be run as root

# Exit on error
set -e

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run as root" >&2
    exit 1
fi

# Log file
LOG="/var/log/data-partition-extend.log"
echo "===== Running DATA partition extension script $(date) =====" >> $LOG

# Check if the DATA volume exists
if ! lvdisplay /dev/data_vg/data_lv &>/dev/null; then
    echo "DATA LVM volume not found. Please run the setup script first." | tee -a $LOG
    exit 1
fi

# Function to check if disk has been expanded
check_disk_expanded() {
    local disk="$1"
    local data_part="$2"
    echo "Checking if disk $disk has been expanded..." | tee -a $LOG

    # Get the current disk size in sectors
    local disk_sectors=$(blockdev --getsz "$disk")

    # Get information about the last partition
    local part_info=$(sgdisk -i $(echo "$data_part" | sed 's/.*sda//') "$disk")
    local part_last_sector=$(echo "$part_info" | grep "Last sector:" | awk '{print $3}')

    # Calculate difference in sectors
    local unallocated_sectors=$((disk_sectors - part_last_sector - 1))
    local unallocated_mb=$((unallocated_sectors * 512 / 1024 / 1024))

    echo "Disk total sectors: ${disk_sectors}" | tee -a $LOG
    echo "Last partition ends at sector: ${part_last_sector}" | tee -a $LOG
    echo "Unallocated space: ${unallocated_mb}MB (${unallocated_sectors} sectors)" | tee -a $LOG

    # Check if there's significant unallocated space (more than 10MB)
    if [ "$unallocated_mb" -gt 10 ]; then
        echo "Found approximately ${unallocated_mb}MB of unallocated space" | tee -a $LOG
        return 0
    else
        echo "No significant unallocated space found (only ${unallocated_mb}MB)" | tee -a $LOG
        return 1
    fi
}

# Function to check if LVM has space that needs to be extended
check_lvm_needs_extension() {
    local vg="$1"
    local lv="$2"
    local pv="$3"

    # Check if PV has free space that isn't allocated to LV
    local pv_free=$(pvs --units m --noheadings --nosuffix -o pv_free "$pv" | tr -d ' ')

    echo "Physical volume free space: ${pv_free}MB" | tee -a $LOG

    # If we have more than 10MB free space in PV, we should extend the LV
    if (( $(echo "$pv_free > 10" | bc -l) )); then
        echo "Found ${pv_free}MB of unallocated space in PV" | tee -a $LOG
        return 0
    else
        echo "No significant unallocated space in PV (only ${pv_free}MB)" | tee -a $LOG
        return 1
    fi
}

# Main script
DISK="/dev/sda"
DATA_PART="/dev/sda4"
LVM_VG="data_vg"
LVM_LV="data_lv"

# Step 1: Check if there's unallocated space on the disk
if check_disk_expanded "$DISK" "$DATA_PART"; then
    echo "Found unallocated space on disk, extending partition $DATA_PART..." | tee -a $LOG

    # First, fix the GPT table to use all available space
    echo "Fixing GPT to use all available space..." | tee -a $LOG
    sgdisk -e "$DISK" >> $LOG 2>&1

    # Get the current partition details
    PART_NUM=$(echo "$DATA_PART" | sed 's/.*sda//')
    PART_INFO=$(sgdisk -i "$PART_NUM" "$DISK")
    START_SECTOR=$(echo "$PART_INFO" | grep "First sector:" | awk '{print $3}')

    echo "Partition starts at sector: $START_SECTOR" | tee -a $LOG

    # Backup the partition table (just in case)
    sgdisk --backup=/root/sda_partition_backup "$DISK" >> $LOG 2>&1

    # Delete and recreate the partition with the same starting point but extending to end of disk
    echo "Recreating partition $DATA_PART to use all available space..." | tee -a $LOG
    sgdisk -d "$PART_NUM" "$DISK" >> $LOG 2>&1
    sgdisk -n ${PART_NUM}:${START_SECTOR}:0 -t ${PART_NUM}:8e00 "$DISK" >> $LOG 2>&1

    # Update kernel to see the new partition size
    echo "Updating partition table..." | tee -a $LOG
    partprobe "$DISK"
    sleep 3

    # Verify the partition was extended
    echo "Verifying new partition size..." | tee -a $LOG
    lsblk "$DATA_PART" | tee -a $LOG

    # Resize the physical volume to use the new space
    echo "Resizing LVM physical volume..." | tee -a $LOG
    pvresize "$DATA_PART" >> $LOG 2>&1

    # Check if the LV needs extending
    if check_lvm_needs_extension "$LVM_VG" "$LVM_LV" "$DATA_PART"; then
        # Extend the logical volume to use all available space
        echo "Extending logical volume..." | tee -a $LOG
        lvextend -l +100%FREE "/dev/${LVM_VG}/${LVM_LV}" >> $LOG 2>&1

        # Resize the filesystem to use the new space
        echo "Resizing filesystem..." | tee -a $LOG
        resize2fs "/dev/${LVM_VG}/${LVM_LV}" >> $LOG 2>&1

        echo "SUCCESS: DATA partition extended successfully!" | tee -a $LOG
        # Show the new size
        df -h /DATA | tee -a $LOG
    else
        echo "LVM already using all available space. No extension needed." | tee -a $LOG
    fi
else
    echo "No disk expansion detected. No action needed." | tee -a $LOG
fi

exit 0