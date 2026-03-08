# Docker Compose Services

The complete application stack orchestrated via Docker Compose.

```mermaid
flowchart TB
    subgraph DockerNetwork["Docker Network: jwst-network"]
        subgraph Frontend["frontend"]
            ReactContainer["React App\nPort: 3000"]
        end

        subgraph Backend["backend"]
            DotNetContainer[".NET API\nPort: 5001"]
        end

        subgraph MastProxy["mast-proxy"]
            MastContainer["FastAPI (MAST)\nPort: 8002\n~100-200 MB"]
        end

        subgraph Processing["processing-engine"]
            PythonContainer["FastAPI (Processing)\nPort: 8000\n~2-4 GB"]
        end

        subgraph Database["mongodb"]
            MongoContainer["MongoDB\nPort: 27017"]
        end

        subgraph Docs["docs"]
            DocsContainer["MkDocs\nPort: 8001"]
        end

        subgraph S3Dev["seaweedfs (s3 profile)"]
            SeaweedFS["SeaweedFS\nPort: 8333"]
        end

        subgraph Volumes["Volumes"]
            MongoData[("mongo-data")]
        end
    end

    subgraph Host["Host Machine"]
        Browser["Browser\nlocalhost:3000"]
    end

    Browser --> ReactContainer
    ReactContainer --> DotNetContainer
    DotNetContainer --> MastContainer
    DotNetContainer --> PythonContainer
    DotNetContainer --> MongoContainer
    DotNetContainer --> SeaweedFS
    MastContainer --> SeaweedFS
    PythonContainer --> SeaweedFS
    MongoContainer --> MongoData
```

---

[Back to Architecture Overview](index.md)
