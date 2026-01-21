# JWST Data Analysis Application - Development Plan

## Overview

This document outlines the comprehensive development plan for building a JWST data analysis application with advanced computer science capabilities. The project is structured in 6 phases over 12 weeks.

## Technology Stack

### **Technology Stack Selection:**

- [x] React with TypeScript for frontend
- [x] Backend: .NET 10 Web API (using C# expertise)
- [x] Database: MongoDB (document database, ideal for flexible data structures)
- [x] Data Processing: Python with scientific libraries (NumPy, SciPy, Astropy)
- [x] Containerization: Docker for consistent deployment

## Phase Breakdown

### **Phase 1: Foundation & Architecture (Weeks 1-2)** ✅ *Completed*

#### **Key Components:**

- [x] Data Ingestion Layer for various JWST data formats
- [x] Storage Layer with flexible MongoDB schemas
- [x] Processing Engine for scientific computations
- [x] API Gateway for orchestration
- [x] React dashboard for data visualization

#### **Current Status:**

- [x] Project structure setup
- [x] Development plan documentation
- [x] Backend .NET project initialization
- [x] Frontend React project setup
- [x] MongoDB connection configuration
- [x] Basic API structure
- [x] Flexible data models for JWST data
- [x] CRUD operations for data management
- [x] Modern React dashboard with search and filtering
- [x] Docker configuration for all services
- [x] Python processing engine foundation
- [x] Comprehensive setup documentation

#### **Phase 1 Deliverables:**

- ✅ Complete project architecture
- ✅ .NET 10 Web API with MongoDB integration
- ✅ React TypeScript frontend with modern UI
- ✅ Flexible data models for various JWST data types
- ✅ Docker containerization for all services
- ✅ Python processing engine foundation
- ✅ Comprehensive documentation and setup guides

---

### **Phase 2: Core Infrastructure (Weeks 3-4)** ✅ *Complete*

#### **Backend Development:**

- [x] Set up .NET 10 Web API project
- [x] Implement MongoDB connection and basic CRUD operations
- [x] Create flexible data models for different JWST data types
- [x] Build data ingestion pipeline for FITS files and raw sensor data
- [x] Implement authentication and authorization
- [x] Enhance data models with rich metadata (image, sensor, spectral, calibration, processing results, etc.)
- [x] Add DTOs and validation attributes for robust API requests/responses
- [x] Improve MongoDBService with advanced querying, aggregation, statistics, and bulk operations
- [x] Merge advanced endpoints into JwstDataController (search, statistics, bulk update, export)
- [x] Fix nullable reference type issues and ensure all endpoints are discoverable and functional
- [x] Robust error handling and validation
- [x] Update documentation and setup guide

#### **Database Design:**

- [x] Design flexible document schemas for:
  - [x] Image data (metadata + binary storage)
  - [x] Raw sensor data (time series, spectral data)
  - [x] Processing results and analysis outputs
  - [x] User sessions and preferences

#### **Phase 2 Summary:**

- Enhanced data models with comprehensive metadata
- Improved API endpoints for search, statistics, bulk operations, and export
- Robust MongoDB service with advanced querying and aggregation
- Successful testing of all new features
- Documentation updated

#### **Deliverables:**

- ✅ Functional .NET API with MongoDB integration
- ✅ Data models for various JWST data types
- ✅ Basic authentication system
- ✅ File upload and storage capabilities
- ✅ Advanced endpoints for search, statistics, bulk update, and export
- ✅ Robust validation and error handling
- ✅ Updated documentation

---

### **Phase 3: Data Processing Engine (Weeks 5-6)** 🔄 *In Progress*

#### **Python Microservice:**

- [x] Create Python service for scientific computations
- [x] Integrate with Astropy for astronomical data processing
- [x] MAST Portal integration with astroquery
- [ ] Implement common JWST data analysis algorithms
- [ ] Build image processing capabilities (filters, transformations)
- [ ] Create spectral analysis tools

#### **Processing Capabilities:**

- [ ] Image enhancement and filtering
- [ ] Spectral data analysis
- [ ] Noise reduction algorithms
- [ ] Data calibration and normalization
- [ ] Statistical analysis tools

#### **MAST Portal Integration:** ✅ *Complete*

- [x] Search MAST by target name (e.g., "NGC 3132", "Carina Nebula")
- [x] Search MAST by RA/Dec coordinates with configurable radius
- [x] Search MAST by observation ID
- [x] Search MAST by program/proposal ID
- [x] Download FITS files from MAST to local storage
- [x] Import downloaded files into MongoDB with metadata extraction
- [x] Frontend UI for MAST search and import workflow

#### **Processing Level Tracking:** ✅ *Complete*

- [x] Parse JWST filename patterns to extract processing level (L1/L2a/L2b/L3)
- [x] Track observation base ID and exposure ID for lineage grouping
- [x] Establish parent-child relationships between processing levels
- [x] Add lineage API endpoints (`/api/jwstdata/lineage`)
- [x] Frontend lineage tree view with collapsible hierarchy
- [x] Color-coded level badges (L1:red, L2a:amber, L2b:emerald, L3:blue)
- [x] Migration endpoint to backfill existing data

#### **Phase 3 Deliverables:**

- ✅ Python microservice with scientific computing capabilities
- ✅ Integration with .NET backend (HTTP client communication)
- ✅ MAST Portal search and download functionality
- ✅ Processing level tracking and lineage visualization
- [ ] Basic image and spectral processing algorithms
- [ ] Processing job queue system

---

### **Phase 4: Frontend Development (Weeks 7-8)**

#### **React Application:**

- [ ] Modern, responsive dashboard design
- [ ] Interactive data visualization components
- [ ] File upload interface for JWST data
- [ ] Real-time processing status updates
- [ ] Results display with export capabilities

#### **Visualization Features:**

- [ ] Interactive image viewers with zoom/pan
- [ ] Spectral data plots and charts
- [ ] 3D data visualization (if applicable)
- [ ] Comparison tools for different datasets
- [ ] Export functionality for processed results

#### **Phase 4 Deliverables:**

- Complete React frontend application
- Interactive data visualization components
- File upload and management interface
- Real-time processing status dashboard

---

### **Phase 5: Integration & Advanced Features (Weeks 9-10)**

#### **System Integration:**

- [ ] Connect all microservices
- [ ] Implement real-time communication
- [ ] Add caching layer for performance
- [ ] Create comprehensive error handling
- [ ] Build monitoring and logging

#### **Advanced Features:**

- [ ] Batch processing capabilities
- [ ] Custom algorithm development interface
- [ ] Data sharing and collaboration tools
- [ ] Automated data validation
- [ ] Performance optimization

#### **Phase 5 Deliverables:**

- Fully integrated system
- Advanced processing features
- Performance optimizations
- Comprehensive error handling

---

### **Phase 6: Testing & Deployment (Weeks 11-12)**

#### **Quality Assurance:**

- [ ] Unit and integration testing
- [ ] Performance testing with large datasets
- [ ] User acceptance testing
- [ ] Security testing and validation

#### **Deployment:**

- [ ] Docker containerization
- [ ] CI/CD pipeline setup
- [ ] Production environment configuration
- [ ] Monitoring and alerting setup

#### **Phase 6 Deliverables:**

- Production-ready application
- Comprehensive test suite
- Deployment automation
- Monitoring and alerting

---

## Technical Architecture

```text
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Frontend│    │  .NET Web API   │    │ Python Processing│    │   MAST Portal   │
│                 │    │                 │    │     Engine      │    │    (STScI)      │
│ - Data Upload   │◄──►│ - Orchestration │◄──►│ - Scientific    │◄──►│ - JWST Archive  │
│ - Visualization │    │ - Authentication│    │   Computing     │    │ - FITS Files    │
│ - MAST Search   │    │ - Data Mgmt     │    │ - MAST Queries  │    │ - Observations  │
│ - Results View  │    │ - MAST Proxy    │    │ - Image Proc    │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                      │
                                ▼                      ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │    MongoDB      │    │  Local Storage  │
                       │                 │    │   /app/data     │
                       │ - Flexible Docs │    │                 │
                       │ - Binary Storage│    │ - Downloaded    │
                       │ - Metadata      │    │   FITS Files    │
                       └─────────────────┘    └─────────────────┘
```

### MAST Integration Data Flow

```text
1. User searches MAST via Frontend
         ↓
2. Request goes to .NET Backend (/api/mast/search/*)
         ↓
3. Backend forwards to Python Processing Engine (/mast/search/*)
         ↓
4. Processing Engine queries MAST via astroquery.mast
         ↓
5. Results returned through chain to Frontend
         ↓
6. User selects observations to import
         ↓
7. Backend calls Processing Engine to download FITS files
         ↓
8. Files saved to shared volume (/app/data/mast/{obs_id}/)
         ↓
9. Backend creates MongoDB records with file paths and metadata
```
