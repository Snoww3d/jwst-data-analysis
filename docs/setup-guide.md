# JWST Data Analysis Application - Setup Guide

## Prerequisites

Before setting up the application, ensure you have the following installed:

- **Docker** and **Docker Compose** (recommended for easy setup)
- **.NET 8 SDK** (for backend development)
- **Node.js 18+** (for frontend development)
- **Python 3.9+** (for processing engine development)
- **MongoDB** (if running locally without Docker)

## Quick Start with Docker (Recommended)

### 1. Clone the Repository

```bash
git clone <repository-url>
cd Astronomy
```

### 2. Start All Services

```bash
cd docker
docker compose up -d
```

This will start:

- MongoDB on port 27017
- .NET Backend API on port 5001
- React Frontend on port 3000
- Python Processing Engine on port 8000

### 3. Access the Application

- **Frontend**: <http://localhost:3000>
- **Backend API**: <http://localhost:5001>
- **API Documentation**: <http://localhost:5001/swagger>
- **Processing Engine**: <http://localhost:8000>

## Development Setup

### Backend (.NET API)

1. **Navigate to backend directory**

   ```bash
   cd backend/JwstDataAnalysis.API
   ```

2. **Restore dependencies**

   ```bash
   dotnet restore
   ```

3. **Run the application**

   ```bash
   dotnet run
   ```

4. **Access the API**

   - API: <http://localhost:5001>
   - Swagger UI: <http://localhost:5001/swagger>

### Frontend (React)

1. **Navigate to frontend directory**

   ```bash
   cd frontend/jwst-frontend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start development server**

   ```bash
   npm start
   ```

4. **Access the application**

   - Frontend: <http://localhost:3000>

### Processing Engine (Python)

1. **Navigate to processing engine directory**

   ```bash
   cd processing-engine
   ```

2. **Create virtual environment**

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application**

   ```bash
   python main.py
   ```

5. **Access the processing engine**

   - API: <http://localhost:8000>
   - Documentation: <http://localhost:8000/docs>

## Database Setup

### MongoDB (Local Installation)

1. **Install MongoDB**
   - **macOS**: `brew install mongodb-community`
   - **Ubuntu**: `sudo apt install mongodb`
   - **Windows**: Download from [MongoDB website](https://www.mongodb.com/try/download/community)

2. **Start MongoDB service**

   ```bash
   # macOS
   brew services start mongodb-community

   # Ubuntu
   sudo systemctl start mongodb

   # Windows
   net start MongoDB
   ```

3. **Verify connection**

   ```bash
   mongosh
   ```

### MongoDB (Docker)

```bash
docker run -d --name mongodb -p 27017:27017 mongo:latest
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# MongoDB
MONGODB_CONNECTION_STRING=mongodb://localhost:27017
MONGODB_DATABASE_NAME=jwst_data_analysis

# API
API_PORT=5001
API_ENVIRONMENT=Development

# Frontend
REACT_APP_API_URL=<http://localhost:5001>

# Processing Engine
PROCESSING_ENGINE_PORT=8000
```

### Backend Configuration

Update `backend/JwstDataAnalysis.API/appsettings.json`:

```json
{
  "MongoDB": {
    "ConnectionString": "mongodb://localhost:27017",
    "DatabaseName": "jwst_data_analysis"
  },
  "Cors": {
    "AllowedOrigins": [
      "<http://localhost:3000>",
      "<http://localhost:3001>"
    ]
  }
}
```

## Testing the Setup

### 1. Test Backend API

```bash
curl <http://localhost:5001/api/jwstdata>
```

### 2. Test Processing Engine

```bash
curl <http://localhost:8000/health>
```

### 3. Test Frontend

Open <http://localhost:3000> in your browser

## Troubleshooting

### Common Issues

1. **Port Already in Use**

   ```bash
   # Find process using port
   lsof -i :5001

   # Kill process
   kill -9 <PID>
   ```

2. **MongoDB Connection Issues**
   - Ensure MongoDB is running
   - Check connection string in configuration
   - Verify network connectivity

3. **CORS Issues**
   - Check CORS configuration in backend
   - Ensure frontend URL is in allowed origins

4. **Docker Issues**

   ```bash
   # Stop all containers
   docker compose down

   # Remove volumes
   docker compose down -v

   # Rebuild containers
   docker compose up --build
   ```

### Logs

View logs for each service:

```bash
# Backend logs
docker logs jwst-backend

# Frontend logs
docker logs jwst-frontend

# Processing engine logs
docker logs jwst-processing

# MongoDB logs
docker logs jwst-mongodb
```

## Development Workflow

1. **Make changes to code**
2. **Test locally**
3. **Commit changes**
4. **Push to repository**
5. **Deploy (if applicable)**

## Next Steps

After successful setup:

1. **Upload sample JWST data** through the web interface
2. **Test processing algorithms** using the dashboard
3. **Explore the API** using Swagger documentation
4. **Review the development plan** in `docs/development-plan.md`

## Support

For issues and questions:

- Check the troubleshooting section above
- Review the development plan
- Create an issue in the repository
