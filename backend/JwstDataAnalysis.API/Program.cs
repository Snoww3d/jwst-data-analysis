// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using AspNetCoreRateLimit;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

// Configure forwarded headers for reverse proxy (nginx) support
// This ensures the app correctly identifies HTTPS requests when behind a proxy
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // Trust the reverse proxy network (Docker internal network)
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

// Add services to the container.
builder.Services.Configure<MongoDBSettings>(
    builder.Configuration.GetSection("MongoDB"));

// Configure rate limiting
builder.Services.AddMemoryCache();
builder.Services.Configure<IpRateLimitOptions>(builder.Configuration.GetSection("IpRateLimiting"));
builder.Services.AddSingleton<IRateLimitConfiguration, RateLimitConfiguration>();
builder.Services.AddInMemoryRateLimiting();

builder.Services.AddSingleton<IMongoDBService, MongoDBService>();
builder.Services.AddSingleton<IImportJobTracker, ImportJobTracker>();

// Configure HttpClient for MastService with reasonable timeout for individual API requests
// Note: The overall download process runs indefinitely until complete or cancelled
builder.Services.AddHttpClient<IMastService, MastService>(client =>
{
    client.Timeout = TimeSpan.FromMinutes(5);
});

builder.Services.AddHttpClient("ProcessingEngine", client =>
{
    var baseUrl = builder.Configuration.GetValue<string>("ProcessingEngine:BaseUrl") ?? "http://localhost:8000";
    client.BaseAddress = new Uri(baseUrl);
});

builder.Services.AddControllers();
builder.Services.AddHealthChecks();

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy(
        "AllowReactApp",
        policy =>
        {
            // Check for comma-separated env var first, then fall back to config array
            var corsEnvVar = Environment.GetEnvironmentVariable("CORS_ALLOWED_ORIGINS");
            var allowedOrigins = !string.IsNullOrEmpty(corsEnvVar)
                ? corsEnvVar.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                : builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>();

            // Use configured origins, or default to localhost for development
            if (allowedOrigins != null && allowedOrigins.Length > 0)
            {
                policy.WithOrigins(allowedOrigins)
                      .AllowAnyHeader()
                      .AllowAnyMethod()
                      .AllowCredentials();
            }
            else if (builder.Environment.IsDevelopment())
            {
                // Development defaults - localhost only
                policy.WithOrigins(
                        "http://localhost:3000",
                        "http://localhost:5173",
                        "http://127.0.0.1:3000",
                        "http://127.0.0.1:5173")
                      .AllowAnyHeader()
                      .AllowAnyMethod()
                      .AllowCredentials();
            }
            else
            {
                // Production with no configured origins - deny all cross-origin requests
                policy.WithOrigins("https://example.com") // Placeholder that won't match
                      .AllowAnyHeader()
                      .AllowAnyMethod();
            }
        });
});

var app = builder.Build();

// Initialize MongoDB indexes during startup
using (var scope = app.Services.CreateScope())
{
    var mongoService = scope.ServiceProvider.GetRequiredService<IMongoDBService>();
    await mongoService.EnsureIndexesAsync();
}

// Configure the HTTP request pipeline.

// Must be first: Handle forwarded headers from reverse proxy (nginx)
// This allows the app to correctly identify the original protocol (HTTPS) and client IP
app.UseForwardedHeaders();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    // Production: Enable HTTPS redirect and HSTS
    // Note: When behind a reverse proxy (nginx), the proxy handles TLS termination
    // and forwards X-Forwarded-Proto header. The app uses this to generate HTTPS URLs.
    app.UseHttpsRedirection();

    // HTTP Strict Transport Security (HSTS)
    // Tells browsers to only use HTTPS for this domain for 1 year
    app.UseHsts();
}

// Rate limiting should be early in the pipeline
app.UseIpRateLimiting();

app.UseCors("AllowReactApp");

app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/api/health");

app.Run();
