FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 5000

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
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
ENTRYPOINT ["dotnet", "JwstDataAnalysis.API.dll"] 