# Define variables
$composePath = "./dev/run"

# Change to the compose directory
Push-Location $composePath

try {
    Write-Host "Starting Docker Compose services..."

    # Stop and remove existing containers and volumes
    # docker-compose down -v

    # Build and run the services
    docker-compose up -d --build

    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed. Exiting."
    }

    Write-Host "Main app available at: http://localhost:4342"
    Write-Host "if you want a clean install please delete the associated docker volumes"
    Write-Host "on clean install remember to create a casaos user"
}
catch {
    Write-Host "Error: $_"
    exit $LASTEXITCODE
}
finally {
    # Return to original path
    Pop-Location
}
