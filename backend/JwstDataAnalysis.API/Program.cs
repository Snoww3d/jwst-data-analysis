// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;

using AspNetCoreRateLimit;
using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Hubs;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using Polly.Timeout;

var builder = WebApplication.CreateBuilder(args);

// Configure forwarded headers for reverse proxy (nginx) support
// This ensures the app correctly identifies HTTPS requests when behind a proxy
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

    // Only trust RFC 1918 private networks (Docker bridge, compose networks),
    // not arbitrary X-Forwarded-For headers from the internet
    options.KnownIPNetworks.Add(new System.Net.IPNetwork(System.Net.IPAddress.Parse("172.16.0.0"), 12));
    options.KnownIPNetworks.Add(new System.Net.IPNetwork(System.Net.IPAddress.Parse("10.0.0.0"), 8));
    options.KnownIPNetworks.Add(new System.Net.IPNetwork(System.Net.IPAddress.Parse("192.168.0.0"), 16));
});

// Add services to the container.
builder.Services.Configure<MongoDBSettings>(
    builder.Configuration.GetSection("MongoDB"));

// Configure rate limiting
builder.Services.AddMemoryCache();
builder.Services.Configure<IpRateLimitOptions>(builder.Configuration.GetSection("IpRateLimiting"));

// Ipv4MappedRateLimitConfiguration normalizes IPv6-mapped IPv4 client addresses
// (::ffff:a.b.c.d from the Docker bridge) so IPv4 whitelist CIDRs match (#1615)
builder.Services.AddSingleton<IRateLimitConfiguration, Ipv4MappedRateLimitConfiguration>();
builder.Services.AddInMemoryRateLimiting();

// Storage provider: conditional registration based on configuration
var storageProviderType = builder.Configuration.GetValue<string>("Storage:Provider")?.ToLowerInvariant() ?? "local";
if (storageProviderType == "s3")
{
    builder.Services.Configure<S3Settings>(builder.Configuration.GetSection("Storage:S3"));
    builder.Services.AddSingleton<IStorageProvider, S3StorageProvider>();
}
else
{
    builder.Services.AddSingleton<IStorageProvider, LocalStorageProvider>();
}

builder.Services.AddSingleton<IMongoDBService, MongoDBService>();
builder.Services.AddSingleton<IImportJobTracker, ImportJobTracker>();

// Configure seeding
builder.Services.Configure<SeedingSettings>(builder.Configuration.GetSection("Seeding"));

// Configure observation mosaic auto-generation
builder.Services.Configure<ObservationMosaicSettings>(builder.Configuration.GetSection("ObservationMosaic"));
builder.Services.AddSingleton<ObservationMosaicTracker>();

// Configure JWT Authentication
builder.Services.Configure<JwtSettings>(builder.Configuration.GetSection("Jwt"));
builder.Services.AddSingleton<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IAuthService, AuthService>();

var jwtSettings = builder.Configuration.GetSection("Jwt").Get<JwtSettings>()
    ?? throw new InvalidOperationException("JWT settings not configured");

// Guard: refuse to start with the well-known placeholder key outside Development
if (!builder.Environment.IsDevelopment()
    && jwtSettings.SecretKey.Contains("CHANGE_THIS", StringComparison.OrdinalIgnoreCase))
{
    throw new InvalidOperationException(
        "JWT SecretKey contains the default placeholder. Set a secure key via Jwt__SecretKey environment variable.");
}

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.SecretKey)),
        ValidateIssuer = true,
        ValidIssuer = jwtSettings.Issuer,
        ValidateAudience = true,
        ValidAudience = jwtSettings.Audience,
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromSeconds(jwtSettings.ClockSkewSeconds),
    };

    // SignalR sends the JWT via query string since WebSockets can't send custom headers.
    // Extract the token from ?access_token= for hub routes only.
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            var accessToken = context.Request.Query["access_token"];
            var path = context.HttpContext.Request.Path;
            if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
            {
                context.Token = accessToken;
            }

            return Task.CompletedTask;
        },
    };
});

// Configure Authorization Policies
builder.Services.AddAuthorization(options => options.AddPolicy("AdminOnly", policy => policy.RequireRole("Admin")));

// Configure HttpClient for MastService — routes to the dedicated MAST proxy service
// Note: The overall download process runs indefinitely until complete or cancelled
builder.Services.AddHttpClient<IMastService, MastService>(client => client.Timeout = TimeSpan.FromMinutes(5));

// Configure HttpClient for CompositeService — resilience handler owns all timeouts.
// Retry transient failures (connection refused, 502/503/504) with exponential backoff — handles processing engine restarts.
// HttpClient.Timeout disabled so it doesn't race with the resilience pipeline's TotalRequestTimeout.
// Generous timeouts: background job queue means no user blocking on HTTP; large multi-channel
// composites (4ch × 49 tiles) can take 30+ minutes on modest hardware.
builder.Services.AddHttpClient<ICompositeService, CompositeService>(client => client.Timeout = Timeout.InfiniteTimeSpan)
    .AddStandardResilienceHandler(options =>
    {
        options.Retry.MaxRetryAttempts = 3;
        options.Retry.Delay = TimeSpan.FromSeconds(2);

        // Don't retry HTTP 500 (processing engine bugs) — only retry truly transient errors
        options.Retry.ShouldHandle = args => ValueTask.FromResult(
            args.Outcome.Exception is HttpRequestException or TimeoutRejectedException
            || (args.Outcome.Result?.StatusCode is >= (System.Net.HttpStatusCode)500
                and not System.Net.HttpStatusCode.InternalServerError));
        options.AttemptTimeout.Timeout = TimeSpan.FromMinutes(30);
        options.TotalRequestTimeout.Timeout = TimeSpan.FromMinutes(60);
        options.CircuitBreaker.SamplingDuration = TimeSpan.FromMinutes(61);
    });

// Configure HttpClient for MosaicService — same resilience config as CompositeService.
builder.Services.AddHttpClient<IMosaicService, MosaicService>(client => client.Timeout = Timeout.InfiniteTimeSpan)
    .AddStandardResilienceHandler(options =>
    {
        options.Retry.MaxRetryAttempts = 3;
        options.Retry.Delay = TimeSpan.FromSeconds(2);
        options.Retry.ShouldHandle = args => ValueTask.FromResult(
            args.Outcome.Exception is HttpRequestException or TimeoutRejectedException
            || (args.Outcome.Result?.StatusCode is >= (System.Net.HttpStatusCode)500
                and not System.Net.HttpStatusCode.InternalServerError));
        options.AttemptTimeout.Timeout = TimeSpan.FromMinutes(30);
        options.TotalRequestTimeout.Timeout = TimeSpan.FromMinutes(60);
        options.CircuitBreaker.SamplingDuration = TimeSpan.FromMinutes(61);
    });

// Configure HttpClient for AnalysisService with 2-minute timeout for region statistics
builder.Services.AddHttpClient<IAnalysisService, AnalysisService>(client => client.Timeout = TimeSpan.FromMinutes(2));

// Configure HttpClient for DiscoveryService to proxy recipe suggestions to Python engine
builder.Services.AddHttpClient<IDiscoveryService, DiscoveryService>(client => client.Timeout = TimeSpan.FromMinutes(2));

// Configure HttpClient for SemanticSearchService (embedding + search proxied to Python engine)
builder.Services.AddHttpClient<ISemanticSearchService, SemanticSearchService>(client => client.Timeout = TimeSpan.FromMinutes(5));

// Background queue for async embedding jobs (bounded channel, single reader)
builder.Services.AddSingleton<EmbeddingQueue>();
builder.Services.AddHostedService<EmbeddingBackgroundService>();

builder.Services.AddHttpClient("ProcessingEngine", client =>
{
    var baseUrl = builder.Configuration.GetValue<string>("ProcessingEngine:BaseUrl") ?? "http://localhost:8000";
    client.BaseAddress = new Uri(baseUrl);
});

// Named HttpClient for MAST proxy health check
builder.Services.AddHttpClient("MastProxy", client =>
{
    var baseUrl = builder.Configuration.GetValue<string>("MastProxy:BaseUrl")
        ?? builder.Configuration.GetValue<string>("ProcessingEngine:BaseUrl")
        ?? "http://localhost:8000";
    client.BaseAddress = new Uri(baseUrl);
    client.Timeout = TimeSpan.FromSeconds(10);
});

// Configure HttpClient for ThumbnailService with 60-second timeout for thumbnail generation
builder.Services.AddHttpClient("ThumbnailEngine", client =>
{
    var baseUrl = builder.Configuration.GetValue<string>("ProcessingEngine:BaseUrl") ?? "http://localhost:8000";
    client.BaseAddress = new Uri(baseUrl);
    client.Timeout = TimeSpan.FromSeconds(60);
});
builder.Services.AddSingleton<IThumbnailService, ThumbnailService>();

// Background queue for thumbnail generation (replaces fire-and-forget Task.Run)
builder.Services.AddSingleton<ThumbnailQueue>();
builder.Services.AddSingleton<IThumbnailQueue>(sp => sp.GetRequiredService<ThumbnailQueue>());
builder.Services.AddHostedService<ThumbnailBackgroundService>();

// Background queues for async export/save (bounded channels, single reader)
builder.Services.AddSingleton<CompositeQueue>();
builder.Services.AddHostedService<CompositeBackgroundService>();
builder.Services.AddSingleton<MosaicQueue>();
builder.Services.AddHostedService<MosaicBackgroundService>();

// Disk scan service (extracts scan-and-import logic from DataManagementController)
builder.Services.AddScoped<IDataScanService, DataScanService>();
builder.Services.AddHostedService<StartupScanBackgroundService>();

// SignalR for real-time job progress push
builder.Services.AddSignalR()
    .AddJsonProtocol(options =>
    {
        options.PayloadSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    });
builder.Services.AddSingleton<IJobProgressNotifier, JobProgressNotifier>();

// Unified job tracker (MongoDB-backed with in-memory cache)
builder.Services.AddSingleton<IJobTracker, JobTracker>();
builder.Services.AddHostedService<StartupReconciliationService>();
builder.Services.AddHostedService<JobReaperBackgroundService>();

builder.Services.AddControllers();
builder.Services.AddHealthChecks()
    .AddCheck<ProcessingEngineHealthCheck>(
        "processing_engine",
        failureStatus: Microsoft.Extensions.Diagnostics.HealthChecks.HealthStatus.Degraded,
        tags: ["ready"])
    .AddCheck<MastProxyHealthCheck>(
        "mast_proxy",
        failureStatus: Microsoft.Extensions.Diagnostics.HealthChecks.HealthStatus.Degraded,
        tags: ["ready"]);

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "JWST Data Analysis API",
        Version = "v1",
        Description = "API for analyzing James Webb Space Telescope data",
    });

    // Include XML comments from the generated documentation file
    var xmlFilename = $"{System.Reflection.Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFilename);
    if (File.Exists(xmlPath))
    {
        options.IncludeXmlComments(xmlPath);
    }

    // Add JWT Authentication to Swagger
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter your JWT token",
    });

    // Add global security requirement - apply Bearer auth to all endpoints
    // Swashbuckle v10 uses a delegate to resolve security requirements
    options.AddSecurityRequirement(_ => new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecuritySchemeReference("Bearer", null),
            new List<string>()
        },
    });
});

// Configure CORS
builder.Services.AddCors(options => options.AddPolicy(
        "AllowReactApp",
        policy =>
        {
            // Check for comma-separated env var first, then fall back to config array
            var corsEnvVar = Environment.GetEnvironmentVariable("CORS_ALLOWED_ORIGINS");
            var allowedOrigins = !string.IsNullOrEmpty(corsEnvVar)
                ? corsEnvVar.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                : builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>();

            // Headers the engine adds to /composite responses that the
            // frontend needs to read off `Response.headers.get(...)`.
            // Browsers won't expose non-simple response headers without
            // an explicit Access-Control-Expose-Headers entry.
            string[] exposedHeaders =
            [
                "X-Composite-Budget-Status",
                "X-Composite-Was-Downscaled",
                "X-Composite-Original-Shape",
                "X-Composite-Output-Shape",
                "X-Composite-Side-Factor",
                "X-Composite-Auto-Feather",
                "X-Composite-Feather-Strength",
                "X-Quality-Score",
                "X-Quality-SNR",
                "X-Quality-Balance",
                "X-Quality-Spread",
                "X-Quality-Coverage",
            ];

            // Use configured origins, or default to localhost for development
            if (allowedOrigins != null && allowedOrigins.Length > 0)
            {
                policy.WithOrigins(allowedOrigins)
                      .AllowAnyHeader()
                      .AllowAnyMethod()
                      .AllowCredentials()
                      .WithExposedHeaders(exposedHeaders);
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
                      .AllowCredentials()
                      .WithExposedHeaders(exposedHeaders);
            }
            else
            {
                // Production with no configured origins - deny all cross-origin requests.
                // Still expose headers for defense in depth: if a future operator softens
                // this fallback, headers should propagate without a separate config change.
                policy.WithOrigins("https://example.com") // Placeholder that won't match
                      .AllowAnyHeader()
                      .AllowAnyMethod()
                      .WithExposedHeaders(exposedHeaders);
            }
        }));

var app = builder.Build();

// Initialize MongoDB indexes and seed data during startup
using (var scope = app.Services.CreateScope())
{
    var mongoService = scope.ServiceProvider.GetRequiredService<IMongoDBService>();

    // Clean up duplicate records and fix MAST data before enforcing unique index
    await mongoService.DeduplicateRecordsAsync();
    await mongoService.MarkMastDataPublicAsync();

    await mongoService.EnsureIndexesAsync();
    await mongoService.EnsureUserIndexesAsync();

    // Seed default users (controlled by Seeding:Enabled configuration)
    var seedService = new SeedDataService(
        mongoService,
        scope.ServiceProvider.GetRequiredService<IAuthService>(),
        Microsoft.Extensions.Options.Options.Create(
            builder.Configuration.GetSection("Seeding").Get<SeedingSettings>() ?? new SeedingSettings()),
        app.Environment,
        app.Services.GetRequiredService<ILoggerFactory>().CreateLogger<SeedDataService>());
    await seedService.SeedUsersAsync();
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

// Security headers — applied to all responses
app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;
    headers["X-Content-Type-Options"] = "nosniff";
    headers["X-Frame-Options"] = "DENY";
    headers["X-XSS-Protection"] = "0"; // Disable legacy XSS filter (can introduce vulnerabilities)
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
    await next();
});

// CORS must be before rate limiting so 429 responses include CORS headers
app.UseCors("AllowReactApp");

// Rate limiting should be early in the pipeline (but after CORS)
app.UseIpRateLimiting();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<JobProgressHub>("/hubs/job-progress");
app.MapHealthChecks("/api/health", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";
        var result = new
        {
            status = report.Status.ToString(),
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),
                description = e.Value.Description,
            }),
        };
        await context.Response.WriteAsJsonAsync(result);
    },
});

app.Run();
