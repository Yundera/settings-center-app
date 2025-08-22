import dotenv from 'dotenv';

/**
 * Loads environment variables from .env files programmatically using dotenv
 * This replaces Docker's env_file functionality
 */
export function initializeEnvironment(): void {
    const basePath = '/DATA/AppData/casaos/apps/yundera';
    
    // Load each environment file - dotenv silently ignores missing files
    dotenv.config({ path: `${basePath}/.pcs.env`, override: false });
    dotenv.config({ path: `${basePath}/.pcs.secret.env`, override: false });
    dotenv.config({ path: `${basePath}/.ynd.user.env`, override: false });
}