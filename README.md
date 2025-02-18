# Mesh Dashboard

## Architecture

The project is composed of two sub-projects, managed as GitHub submodules:

1. **settings-dashboard**  
   Path: `./settings-dashboard/`  
   Documentation: [settings-dashboard readme](./settings-dashboard/readme.md)

2. **dashboard-core**  
   Path: `./dashboard-core/`  
   Documentation: [dashboard-core readme](./dashboard-core/readme.md)

## Getting Started

### Installation

Install project dependencies:
```bash
pnpm install
```

### Configuration

Configure the following environment variables by referring to their respective documentation:

1. Core Configuration  
   Path: `./settings-dashboard/config/core.env.json`  
   Documentation: [core.env.json documentation](./settings-dashboard/config/core.env.json.md)

### Development

Start the development server:
```bash
pnpm start
```

## Deployment

Build and publish using Dockflow:

```bash
npx dockflow build
npx dockflow publish
```

## Project Structure
```
./
├── settings-dashboard/          # Main dashboard application
│   ├── config/
│   │   ├── core.env.json
│   └── readme.md
├── dashboard-core/              # Core functionality
│   └── readme.md
└── README.md*
```