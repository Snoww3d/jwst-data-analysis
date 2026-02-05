FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
EXPOSE 5000

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["JwstDataAnalysis.API.csproj", "./"]
RUN dotnet restore "JwstDataAnalysis.API.csproj"
COPY . .
WORKDIR "/src/."
RUN dotnet build "JwstDataAnalysis.API.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "JwstDataAnalysis.API.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

# Create non-root user and writable data directory for MAST downloads/uploads
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup --no-create-home appuser && \
    mkdir -p /app/data && \
    chown -R appuser:appgroup /app/data

USER appuser

ENTRYPOINT ["dotnet", "JwstDataAnalysis.API.dll"]