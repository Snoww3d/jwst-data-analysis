# JWST Data Analysis Application

A comprehensive application for analyzing James Webb Space Telescope (JWST) data with advanced computer science capabilities.

## Project Overview

This application provides a modern web interface for uploading, processing, and analyzing JWST data. It supports various data types including images, raw sensor data, and spectral information.

## Technology Stack

- **Frontend**: React with TypeScript
- **Backend**: .NET 8 Web API
- **Database**: MongoDB (Document Database)
- **Data Processing**: Python with scientific libraries
- **Containerization**: Docker

## Quick Start

### Prerequisites
- .NET 8 SDK
- Node.js 18+
- MongoDB
- Python 3.9+
- Docker (optional)

### Development Setup

1. **Backend Setup**
   ```bash
   cd backend
   dotnet restore
   dotnet run
   ```

2. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   npm start
   ```

3. **Database Setup**
   - Ensure MongoDB is running locally or update connection string in `backend/appsettings.json`

4. **Docker Setup (Alternative)**
   ```bash
   cd docker
   docker compose up -d
   ```

## Project Structure

```
Astronomy/
├── backend/                 # .NET 8 Web API
├── frontend/               # React TypeScript application
├── processing-engine/      # Python scientific computing service
├── docs/                   # Documentation
└── docker/                 # Docker configuration
```

## Features

- **Data Ingestion**: Support for FITS files, raw sensor data, and images
- **Flexible Storage**: MongoDB document database for various data types
- **Scientific Processing**: Python-based analysis engine
- **Modern UI**: React dashboard with interactive visualizations
- **Real-time Processing**: Live status updates and progress tracking

## Development Phases

See [Development Plan](./docs/development-plan.md) for detailed phase breakdown.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details. 