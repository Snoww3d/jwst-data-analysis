// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using AspNetCoreRateLimit;
using Microsoft.Extensions.Options;

namespace JwstDataAnalysis.API.Configuration
{
    /// <summary>
    /// Rate limit configuration that normalizes IPv6-mapped IPv4 client addresses
    /// (e.g. <c>::ffff:172.18.0.1</c> from the Docker bridge) to their plain IPv4
    /// form before whitelist matching and counter keying. AspNetCoreRateLimit's
    /// CIDR matching is address-family sensitive, so without this the IPv4
    /// whitelist entries in <c>appsettings.Development.json</c> never match
    /// Docker traffic and dev/E2E requests get rate limited (issue #1615).
    /// </summary>
    public class Ipv4MappedRateLimitConfiguration : RateLimitConfiguration
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="Ipv4MappedRateLimitConfiguration"/> class.
        /// </summary>
        /// <param name="ipOptions">IP rate limit options.</param>
        /// <param name="clientOptions">Client rate limit options.</param>
        public Ipv4MappedRateLimitConfiguration(
            IOptions<IpRateLimitOptions> ipOptions,
            IOptions<ClientRateLimitOptions> clientOptions)
            : base(ipOptions, clientOptions)
        {
        }

        /// <inheritdoc/>
        public override void RegisterResolvers()
        {
            // base.RegisterResolvers() appends, so clear both lists first to keep
            // re-invocation idempotent (no duplicate or double-wrapped resolvers)
            IpResolvers.Clear();
            ClientResolvers.Clear();
            base.RegisterResolvers();

            var wrapped = new List<IIpResolveContributor>(IpResolvers.Count);
            foreach (var resolver in IpResolvers)
            {
                wrapped.Add(new Ipv4MappedIpResolveContributor(resolver));
            }

            IpResolvers.Clear();
            foreach (var resolver in wrapped)
            {
                IpResolvers.Add(resolver);
            }
        }
    }
}
