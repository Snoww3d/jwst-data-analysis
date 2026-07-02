// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;

using AspNetCoreRateLimit;

namespace JwstDataAnalysis.API.Configuration
{
    /// <summary>
    /// Decorates an <see cref="IIpResolveContributor"/> so IPv6-mapped IPv4
    /// addresses (<c>::ffff:a.b.c.d</c>) resolve to their plain IPv4 form.
    /// Anything that doesn't parse as a single mapped address (plain IPv4,
    /// plain IPv6, comma-separated X-Forwarded-For lists) passes through
    /// unchanged.
    /// </summary>
    public sealed class Ipv4MappedIpResolveContributor : IIpResolveContributor
    {
        private readonly IIpResolveContributor inner;

        /// <summary>
        /// Initializes a new instance of the <see cref="Ipv4MappedIpResolveContributor"/> class.
        /// </summary>
        /// <param name="inner">The resolver to decorate.</param>
        public Ipv4MappedIpResolveContributor(IIpResolveContributor inner)
        {
            this.inner = inner;
        }

        /// <inheritdoc/>
        public string? ResolveIp(HttpContext httpContext)
        {
            var ip = this.inner.ResolveIp(httpContext);
            if (string.IsNullOrEmpty(ip))
            {
                return ip;
            }

            if (IPAddress.TryParse(ip, out var parsed) && parsed.IsIPv4MappedToIPv6)
            {
                return parsed.MapToIPv4().ToString();
            }

            return ip;
        }
    }
}
