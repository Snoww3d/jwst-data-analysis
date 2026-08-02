// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.IO;
using System.Net;

using AspNetCoreRateLimit;
using JwstDataAnalysis.API.Configuration;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace JwstDataAnalysis.API.Tests.Configuration
{
    /// <summary>
    /// Tests for <see cref="Ipv4MappedIpResolveContributor"/> and
    /// <see cref="Ipv4MappedRateLimitConfiguration"/> (#1615): IPv6-mapped IPv4
    /// client addresses must normalize to plain IPv4 so the dev IP whitelist matches.
    /// </summary>
    public class Ipv4MappedRateLimitConfigurationTests
    {
        [Theory]
        [InlineData("::ffff:172.18.0.1", "172.18.0.1")] // Docker bridge (Linux)
        [InlineData("::ffff:192.168.65.1", "192.168.65.1")] // Docker Desktop (macOS)
        [InlineData("::ffff:127.0.0.1", "127.0.0.1")] // mapped loopback
        public void ResolveIp_Ipv6MappedIpv4_ReturnsPlainIpv4(string mapped, string expected)
        {
            var contributor = WrapFixedResult(mapped);

            var result = contributor.ResolveIp(new DefaultHttpContext());

            Assert.Equal(expected, result);
        }

        [Theory]
        [InlineData("172.18.0.1")] // plain IPv4
        [InlineData("::1")] // plain IPv6 loopback
        [InlineData("2001:db8::1")] // plain IPv6
        [InlineData("203.0.113.7, 172.18.0.1")] // X-Forwarded-For list, not a single IP
        [InlineData("not-an-ip")]
        public void ResolveIp_NonMappedValues_PassThroughUnchanged(string value)
        {
            var contributor = WrapFixedResult(value);

            var result = contributor.ResolveIp(new DefaultHttpContext());

            Assert.Equal(value, result);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        public void ResolveIp_NullOrEmpty_PassesThrough(string? value)
        {
            var contributor = WrapFixedResult(value);

            var result = contributor.ResolveIp(new DefaultHttpContext());

            Assert.Equal(value, result);
        }

        [Fact]
        public void ResolveIp_UsesConnectionRemoteIpAddress_NormalizesMappedAddress()
        {
            var configuration = CreateConfiguration();
            var context = new DefaultHttpContext();
            context.Connection.RemoteIpAddress = IPAddress.Parse("::ffff:172.18.0.1");

            var resolved = ResolveThroughConfiguration(configuration, context);

            Assert.Equal("172.18.0.1", resolved);
        }

        [Fact]
        public void RegisterResolvers_WrapsEveryResolver()
        {
            var configuration = CreateConfiguration();

            Assert.NotEmpty(configuration.IpResolvers);
            Assert.All(
                configuration.IpResolvers,
                resolver => Assert.IsType<Ipv4MappedIpResolveContributor>(resolver));
        }

        /// <summary>
        /// Updated for #1620. This previously asserted our resolver count matched
        /// the stock configuration's — i.e. that the header resolver was kept.
        /// Keeping it is the defect: it let a client-supplied header key the rate
        /// limiter, bypassing the ForwardedHeaders trust list. We now register
        /// strictly fewer resolvers than stock, and the missing one is the header.
        /// </summary>
        [Fact]
        public void RegisterResolvers_DropsTheHeaderResolverStockWouldRegister()
        {
            var stock = new RateLimitConfiguration(
                CreateIpOptions(),
                Options.Create(new ClientRateLimitOptions()));
            stock.RegisterResolvers();
            var configuration = CreateConfiguration();

            Assert.Contains(stock.IpResolvers, resolver => resolver is IpHeaderResolveContributor);
            Assert.Equal(stock.IpResolvers.Count - 1, configuration.IpResolvers.Count);
            Assert.All(
                configuration.IpResolvers,
                resolver => Assert.IsNotType<IpHeaderResolveContributor>(resolver));
        }

        [Fact]
        public void RegisterResolvers_InvokedTwice_DoesNotDuplicateResolvers()
        {
            var configuration = CreateConfiguration();
            var ipCount = configuration.IpResolvers.Count;
            var clientCount = configuration.ClientResolvers.Count;

            configuration.RegisterResolvers();

            Assert.Equal(ipCount, configuration.IpResolvers.Count);
            Assert.Equal(clientCount, configuration.ClientResolvers.Count);
        }

        // ===== #1620: client-supplied headers must not key the rate limiter =====

        /// <summary>
        /// The defect, characterized against the stock configuration: with a
        /// RealIpHeader the rate limiter reads that header itself, independent of
        /// the ForwardedHeaders middleware and its RFC 1918 trust list. A client
        /// connecting directly to Kestrel can set it freely and rotate its
        /// rate-limit identity, evading the 5/hour register and 20/15m login limits.
        /// </summary>
        [Fact]
        public void StockConfiguration_LetsForwardedForOverrideTheConnectionAddress()
        {
            var stock = new RateLimitConfiguration(
                Options.Create(new IpRateLimitOptions { RealIpHeader = "X-Forwarded-For" }),
                Options.Create(new ClientRateLimitOptions()));
            stock.RegisterResolvers();
            var context = ContextWith("203.0.113.7", ("X-Forwarded-For", "198.51.100.23"));

            var resolved = ResolveThrough(stock.IpResolvers, context);

            Assert.Equal("198.51.100.23", resolved);
        }

        /// <summary>
        /// Deleting RealIpHeader from appsettings.json — the fix the issue
        /// originally proposed — is NOT enough on its own: the option defaults to
        /// X-Real-IP, so the header resolver stays registered and the bypass just
        /// moves to a different header. This test exists to keep that fact visible.
        /// </summary>
        [Fact]
        public void StockConfiguration_WithNoConfiguredHeader_StillReadsXRealIp()
        {
            Assert.Equal("X-Real-IP", new IpRateLimitOptions().RealIpHeader);

            var stock = new RateLimitConfiguration(
                Options.Create(new IpRateLimitOptions()),
                Options.Create(new ClientRateLimitOptions()));
            stock.RegisterResolvers();
            var context = ContextWith("203.0.113.7", ("X-Real-IP", "198.51.100.23"));

            var resolved = ResolveThrough(stock.IpResolvers, context);

            Assert.Equal("198.51.100.23", resolved);
        }

        /// <summary>
        /// The fix: our configuration drops the header resolver entirely, so no
        /// client-supplied header can influence the key regardless of what
        /// RealIpHeader is set to.
        /// </summary>
        [Theory]
        [InlineData("X-Forwarded-For")]
        [InlineData("X-Real-IP")]
        [InlineData("")]
        [InlineData(null)]
        public void OurConfiguration_IgnoresClientSuppliedHeaders(string? realIpHeader)
        {
            var configuration = CreateConfigurationWith(realIpHeader);
            var context = ContextWith(
                "203.0.113.7",
                ("X-Forwarded-For", "198.51.100.23"),
                ("X-Real-IP", "198.51.100.24"));

            var resolved = ResolveThroughConfiguration(configuration, context);

            Assert.Equal("203.0.113.7", resolved);
        }

        [Fact]
        public void OurConfiguration_SpoofedHeadersCannotRotateTheRateLimitKey()
        {
            // The evasion this closes: same peer, different headers, must key the
            // same bucket or the per-IP limits mean nothing.
            var configuration = CreateConfigurationWith("X-Forwarded-For");

            var first = ContextWith("203.0.113.7", ("X-Forwarded-For", "198.51.100.1"));
            var second = ContextWith("203.0.113.7", ("X-Forwarded-For", "198.51.100.2"));

            Assert.Equal(
                ResolveThroughConfiguration(configuration, first),
                ResolveThroughConfiguration(configuration, second));
        }

        [Fact]
        public void OurConfiguration_RegistersNoHeaderResolver()
        {
            var configuration = CreateConfigurationWith("X-Forwarded-For");

            Assert.NotEmpty(configuration.IpResolvers);
            Assert.All(
                configuration.IpResolvers,
                resolver => Assert.IsNotType<IpHeaderResolveContributor>(resolver));
        }

        /// <summary>
        /// A trusted proxy's forwarding still works — it arrives as the connection
        /// address because ForwardedHeaders rewrote it upstream, which is the
        /// behaviour this fix preserves rather than breaks.
        /// </summary>
        [Fact]
        public void OurConfiguration_StillHonoursAnAddressPromotedByForwardedHeaders()
        {
            var configuration = CreateConfigurationWith("X-Forwarded-For");

            // UseForwardedHeaders has already replaced RemoteIpAddress with the
            // forwarded client, having validated the peer against the trust list.
            var context = ContextWith("198.51.100.23", ("X-Forwarded-For", "198.51.100.23"));

            Assert.Equal("198.51.100.23", ResolveThroughConfiguration(configuration, context));
        }

        /// <summary>
        /// The shipped appsettings.json must not reintroduce RealIpHeader. The
        /// resolver removal already makes it inert, but leaving the key in place
        /// would misdescribe how the limiter works to the next reader.
        /// </summary>
        [Fact]
        public void ShippedConfiguration_DoesNotSetRealIpHeader()
        {
            var section = LoadShippedIpRateLimitingSection();

            Assert.True(
                string.IsNullOrEmpty(section["RealIpHeader"]),
                "appsettings.json must not set IpRateLimiting:RealIpHeader (#1620) — the rate "
                + "limiter keys on Connection.RemoteIpAddress, which the ForwardedHeaders "
                + "trust list in Program.cs gates.");
        }

        [Fact]
        public void ShippedConfiguration_StillDefinesTheAuthRateLimits()
        {
            // Guard against "fixing" this by deleting the section wholesale.
            var options = new IpRateLimitOptions();
            LoadShippedIpRateLimitingSection().Bind(options);

            Assert.Contains(options.GeneralRules, rule => rule.Endpoint == "post:/api/auth/register");
            Assert.Contains(options.GeneralRules, rule => rule.Endpoint == "post:/api/auth/login");
        }

        private static DefaultHttpContext ContextWith(string peer, params (string Name, string Value)[] headers)
        {
            var context = new DefaultHttpContext();
            context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
            foreach (var (name, value) in headers)
            {
                context.Request.Headers[name] = value;
            }

            return context;
        }

        private static string? ResolveThrough(IList<IIpResolveContributor> resolvers, HttpContext context)
        {
            foreach (var resolver in resolvers)
            {
                var ip = resolver.ResolveIp(context);
                if (!string.IsNullOrEmpty(ip))
                {
                    return ip;
                }
            }

            return null;
        }

        private static IConfigurationSection LoadShippedIpRateLimitingSection()
        {
            var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
            var configuration = new ConfigurationBuilder()
                .AddJsonFile(path, optional: false)
                .Build();
            return configuration.GetSection("IpRateLimiting");
        }

        private static Ipv4MappedRateLimitConfiguration CreateConfigurationWith(string? realIpHeader)
        {
            var configuration = new Ipv4MappedRateLimitConfiguration(
                Options.Create(new IpRateLimitOptions { RealIpHeader = realIpHeader! }),
                Options.Create(new ClientRateLimitOptions()));
            configuration.RegisterResolvers();
            return configuration;
        }

        private static Ipv4MappedIpResolveContributor WrapFixedResult(string? value)
        {
            var inner = new Mock<IIpResolveContributor>();
            inner.Setup(x => x.ResolveIp(It.IsAny<HttpContext>())).Returns(value!);
            return new Ipv4MappedIpResolveContributor(inner.Object);
        }

        private static IOptions<IpRateLimitOptions> CreateIpOptions()
        {
            return Options.Create(new IpRateLimitOptions
            {
                RealIpHeader = "X-Forwarded-For",
                IpWhitelist = new List<string> { "127.0.0.1", "::1", "172.16.0.0/12" },
            });
        }

        private static Ipv4MappedRateLimitConfiguration CreateConfiguration()
        {
            var configuration = new Ipv4MappedRateLimitConfiguration(
                CreateIpOptions(),
                Options.Create(new ClientRateLimitOptions()));

            // Mirror the rate limit middleware, which invokes RegisterResolvers()
            configuration.RegisterResolvers();
            return configuration;
        }

        private static string? ResolveThroughConfiguration(
            Ipv4MappedRateLimitConfiguration configuration,
            HttpContext context)
        {
            foreach (var resolver in configuration.IpResolvers)
            {
                var ip = resolver.ResolveIp(context);
                if (!string.IsNullOrEmpty(ip))
                {
                    return ip;
                }
            }

            return null;
        }
    }
}
