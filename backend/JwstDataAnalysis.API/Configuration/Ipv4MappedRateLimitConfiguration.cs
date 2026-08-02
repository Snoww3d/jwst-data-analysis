// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using AspNetCoreRateLimit;
using Microsoft.Extensions.Options;

namespace JwstDataAnalysis.API.Configuration
{
    /// <summary>
    /// Rate limit configuration that does two things.
    /// <para>
    /// First (#1615): normalizes IPv6-mapped IPv4 client addresses
    /// (e.g. <c>::ffff:172.18.0.1</c> from the Docker bridge) to their plain IPv4
    /// form before whitelist matching and counter keying. AspNetCoreRateLimit's
    /// CIDR matching is address-family sensitive, so without this the IPv4
    /// whitelist entries in <c>appsettings.Development.json</c> never match
    /// Docker traffic and dev/E2E requests get rate limited.
    /// </para>
    /// <para>
    /// Second (#1620): removes the header-based IP resolver, so the rate limiter
    /// keys strictly on <see cref="Microsoft.AspNetCore.Http.ConnectionInfo.RemoteIpAddress"/>.
    /// That address is populated from <c>X-Forwarded-For</c> by the
    /// ForwardedHeaders middleware, but ONLY when the immediate peer is inside the
    /// RFC 1918 trust list configured in <c>Program.cs</c> — so the trust list
    /// becomes the single gate on client-supplied addresses. Reading a header here
    /// instead bypasses that gate: a client connecting directly to Kestrel could
    /// set the header freely and rotate its rate-limit identity, evading the
    /// 5/hour register and 20/15m login limits.
    /// </para>
    /// <para>
    /// Deleting <c>RealIpHeader</c> from configuration is NOT sufficient on its
    /// own: <c>IpRateLimitOptions.RealIpHeader</c> defaults to
    /// <c>X-Real-IP</c>, so the resolver would still be registered and the bypass
    /// would simply move to a different header. Removing the resolver is what
    /// closes it, and it cannot be reopened by a configuration edit.
    /// </para>
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

            // #1620: drop the header resolver. Everything the client can set is
            // untrusted here; the ForwardedHeaders middleware is the only place
            // allowed to promote a forwarded address, and only from a trusted peer.
            var kept = new List<IIpResolveContributor>(IpResolvers.Count);
            foreach (var resolver in IpResolvers)
            {
                if (resolver is IpHeaderResolveContributor)
                {
                    continue;
                }

                kept.Add(new Ipv4MappedIpResolveContributor(resolver));
            }

            IpResolvers.Clear();
            foreach (var resolver in kept)
            {
                IpResolvers.Add(resolver);
            }
        }
    }
}
