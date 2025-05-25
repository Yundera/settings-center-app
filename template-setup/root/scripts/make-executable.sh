#!/bin/bash

# Make all script files executable and owned by ubuntu user
find . -type f -exec grep -l '^#!/' {} \; | while read script; do
    chmod +x "$script"
    chown ubuntu:ubuntu "$script"
    echo "Fixed: $script"
done