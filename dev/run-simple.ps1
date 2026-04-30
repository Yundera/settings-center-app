# Define variables
$composePath = "./run"

# Change to the compose directory
Push-Location $composePath

try {
    Write-Host "Starting Docker Compose services with clean environment..."

    # Stop and remove existing containers and volumes for clean testing
    Write-Host "Cleaning up previous containers and volumes..."
    docker-compose down -v

    # Build and run the services
    Write-Host "Building and starting services..."
    docker-compose up -d --build

    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed. Exiting."
    }

    Write-Host "Main app available at: http://localhost:4342"
    Write-Host "Environment started with clean volumes - migrations will run fresh"
    Write-Host "Remember to create a casaos user in the container if needed"
}
catch {
    Write-Host "Error: $_"
    exit $LASTEXITCODE
}
finally {
    # Return to original path
    Pop-Location
}