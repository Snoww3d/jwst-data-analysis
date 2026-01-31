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
   cp .env.example .env  # First time only - customize if needed
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
├── backend/                      # .NET 10 Web API
│   └── JwstDataAnalysis.API/
│       ├── Controllers/          # API endpoints (JwstData, Mast, DataManagement)
│       ├── Services/             # Business logic (MongoDB, Mast, ImportJobTracker)
│       └── Models/               # Data models and DTOs
├── frontend/                     # React TypeScript application
│   └── jwst-frontend/
│       ├── src/components/       # UI components (Dashboard, MastSearch, FitsViewer)
│       ├── src/services/         # API service layer (apiClient, jwstDataService, mastService)
│       ├── src/types/            # TypeScript interfaces
│       └── src/utils/            # Utilities (fitsUtils, colormaps)
├── processing-engine/            # Python scientific computing service
│   └── app/
│       ├── mast/                 # MAST integration (search, download, chunked)
│       └── processing/           # Scientific algorithms
├── docs/                         # Documentation
│   └── standards/                # Development standards
└── docker/                       # Docker configuration
```

## Features

### Data Management
- **Data Ingestion**: Support for FITS files, raw sensor data, and images
- **Flexible Storage**: MongoDB document database for various data types
- **Processing Levels**: Automatic tracking of JWST processing levels (L1/L2a/L2b/L3)
- **Lineage Visualization**: Tree view showing relationships between processing levels

### MAST Portal Integration
- **Multi-Search**: Search by target name, coordinates, observation ID, or program ID
- **Bulk Import**: Download and import multiple observations at once
- **Chunked Downloads**: HTTP Range header support for large files (5MB chunks)
- **Resume Capability**: Resume interrupted downloads from last byte position
- **Progress Tracking**: Real-time byte-level progress with speed and ETA

### FITS Viewer
- **Image Visualization**: View FITS images with zoom, pan, and color maps
- **File Type Detection**: Automatic classification of image vs table FITS files
- **Multiple Color Maps**: Grayscale, heat, cool, rainbow, viridis, magma, inferno
- **Graceful Handling**: Clear messages for non-viewable table files

### Scientific Processing
- **Python Engine**: FastAPI service with NumPy, SciPy, and Astropy
- **Parallel Downloads**: 3 concurrent file downloads using asyncio
- **Modern UI**: React dashboard with interactive visualizations
- **Real-time Updates**: Live status updates and progress tracking

## Development Phases

See [Development Plan](./docs/development-plan.md) for detailed phase breakdown.

## Development Standards

detailed coding standards and guidelines can be found in the [docs/standards](./docs/standards/README.md) directory.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed instructions on our Pull Request workflow and development process.

## Security Note

All credentials are managed via environment variables. For local development:

```bash
cd docker
cp .env.example .env
# Edit .env to customize values (optional for local dev)
docker compose up -d
```

**For production deployments:**

- Set strong, unique values for `MONGO_ROOT_PASSWORD` in your `.env` file
- The `.env` file is gitignored and should never be committed
- Store sensitive information in environment variables or a secrets manager
- Review all environment variables before deploying

## License

MIT License - see LICENSE file for details.
 