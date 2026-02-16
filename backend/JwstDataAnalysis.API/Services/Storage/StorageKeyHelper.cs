// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services.Storage
{
    /// <summary>
    /// Shared utility for converting absolute file paths to relative storage keys.
    /// </summary>
    public static class StorageKeyHelper
    {
        private const string DataPrefix = "/app/data/";

        /// <summary>
        /// Converts an absolute file path to a relative storage key.
        /// After migration, FilePath is already a relative key; this provides
        /// backward compatibility for any records not yet migrated.
        /// </summary>
        /// <param name="filePath">The file path (absolute or relative).</param>
        /// <returns>A relative storage key.</returns>
        public static string ToRelativeKey(string filePath)
        {
            if (filePath.StartsWith(DataPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return filePath[DataPrefix.Length..];
            }

            return filePath;
        }
    }
}
