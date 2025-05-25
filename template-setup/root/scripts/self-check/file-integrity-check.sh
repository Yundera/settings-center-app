#!/bin/bash

ENV_FILE=/DATA/AppData/casaos/apps/yundera/.env
TEMPLATE_FILE=/DATA/AppData/casaos/apps/yundera/compose-template.yml
OUTPUT_FILE=/DATA/AppData/casaos/apps/yundera/docker-compose.yml

# Create a copy of the template file to work with
cp "$TEMPLATE_FILE" "$OUTPUT_FILE"

# Read the environment file and apply substitutions
while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip comments and empty lines
    [[ $key =~ ^#.*$ || -z $key ]] && continue

    # Remove any surrounding quotes from the value
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")

    # Replace %KEY% with value in the output file
    sed -i "s|%${key}%|${value}|g" "$OUTPUT_FILE"

done < "$ENV_FILE"

echo "Successfully generated $OUTPUT_FILE from template using environment variables from $ENV_FILE"

