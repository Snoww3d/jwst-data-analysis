// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;

using AspNetCoreRateLimit;
using JwstDataAnalysis.API.Configuration;
using Microsoft.AspNetCore.Http;
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

        [Fact]
        public void RegisterResolvers_WithRealIpHeader_KeepsConnectionAndHeaderResolvers()
        {
            var stock = new RateLimitConfiguration(
                CreateIpOptions(),
                Options.Create(new ClientRateLimitOptions()));
            stock.RegisterResolvers();
            var configuration = CreateConfiguration();

            Assert.Equal(stock.IpResolvers.Count, configuration.IpResolvers.Count);
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
