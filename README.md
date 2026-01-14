# JWST Data Analysis Application

A comprehensive application for analyzing James Webb Space Telescope (JWST)
data with advanced computer science capabilities.

## Project Overview

This application provides a modern web interface for uploading, processing, and
analyzing JWST data. It supports various data types including images, raw sensor
data, and spectral information.

## Technology Stack

- **Frontend**: React with TypeScript
- **Backend**: .NET 10 Web API
- **Database**: MongoDB (Document Database)
- **Data Processing**: Python with scientific libraries
- **Containerization**: Docker

## Quick Start

### Prerequisites

- .NET 10 SDK
- Node.js 18+
- MongoDB
- Python 3.9+
- Docker (optional)

### Development Setup

1. **Docker Setup (Recommended)**

   This will start the full stack including Backend, Frontend, Processing Engine, and Database.

   ```bash
   cd docker
   docker compose up -d
   ```

2. **Manual Component Setup (Advanced)**

   Only use this if you need to run specific components in isolation for debugging.

   **Backend**
   ```bash
   cd backend
   dotnet restore
   dotnet run
   ```

   **Frontend**
   ```bash
   cd frontend
   npm install
   npm start
   ```

   **Database**
   - Ensure MongoDB is running locally or update validation connection string in `backend/appsettings.json`

## Project Structure

```text
Astronomy/
├── backend/                 # .NET 10 Web API
├── frontend/                # React TypeScript application
├── processing-engine/       # Python scientific computing service
├── docs/                    # Documentation
└── docker/                  # Docker configuration
```

## Features

- **Data Ingestion**: Support for FITS files, raw sensor data, and images
- **Flexible Storage**: MongoDB document database for various data types
- **Scientific Processing**: Python-based analysis engine
- **Modern UI**: React dashboard with interactive visualizations
- **Real-time Processing**: Live status updates and progress tracking

## Development Phases

See [Development Plan](./docs/development-plan.md) for detailed phase breakdown.

## Development Standards

detailed coding standards and guidelines can be found in the [docs/standards](./docs/standards/README.md) directory.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed instructions on our Pull Request workflow and development process.

## Security Note

This repository uses default development credentials (e.g., MongoDB username:
`admin`, password: `password`) and local connection strings for demonstration
and local development purposes only. **Do not use these credentials in
production.**

For production deployments:

- Always use strong, unique passwords and secrets.
- Store sensitive information in environment variables or a secrets manager.
- Add a `.env` file (not committed to version control) for real secrets, and
  provide a `.env.example` for reference.
- Review all configuration files for hardcoded secrets before deploying or
  making the repository public.

## License

MIT License - see LICENSE file for details.
 