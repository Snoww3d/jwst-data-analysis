// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Validates file content by checking magic bytes/signatures to prevent
    /// malicious files being uploaded with renamed extensions.
    /// </summary>
    public static class FileContentValidator
    {
        // File signatures (magic bytes) for supported file types
        private static readonly Dictionary<string, byte[][]> FileSignatures = new()
        {
            // FITS files start with "SIMPLE  " (S-I-M-P-L-E followed by spaces)
            // The actual header is "SIMPLE  =                    T" but we check the first 6 bytes
            { ".fits", new[] { Encoding.ASCII.GetBytes("SIMPLE") } },

            // Gzipped FITS files start with gzip magic bytes (1F 8B)
            { ".fits.gz", new[] { new byte[] { 0x1F, 0x8B } } },
            { ".gz", new[] { new byte[] { 0x1F, 0x8B } } },

            // JPEG files start with FF D8 FF
            { ".jpg", new[] { new byte[] { 0xFF, 0xD8, 0xFF } } },
            { ".jpeg", new[] { new byte[] { 0xFF, 0xD8, 0xFF } } },

            // PNG files start with 89 50 4E 47 0D 0A 1A 0A
            { ".png", new[] { new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A } } },

            // TIFF files start with either "II" (little-endian) or "MM" (big-endian)
            { ".tiff", new[] { new byte[] { 0x49, 0x49, 0x2A, 0x00 }, [0x4D, 0x4D, 0x00, 0x2A] } },
            { ".tif", new[] { new byte[] { 0x49, 0x49, 0x2A, 0x00 }, [0x4D, 0x4D, 0x00, 0x2A] } },
        };

        // Extensions that require text content validation (no binary signature)
        private static readonly HashSet<string> TextFileExtensions = [".csv", ".json"];

        /// <summary>
        /// Validates that a file's content matches its declared extension.
        /// </summary>
        /// <param name="file">The uploaded file to validate.</param>
        /// <param name="errorMessage">Error message if validation fails.</param>
        /// <returns>True if valid, false otherwise.</returns>
        public static async Task<(bool IsValid, string? ErrorMessage)> ValidateFileContentAsync(IFormFile file)
        {
            var fileName = file.FileName.ToLowerInvariant();
            var extension = GetNormalizedExtension(fileName);

            // Check if it's a text file that needs structure validation
            if (TextFileExtensions.Contains(extension))
            {
                return await ValidateTextFileAsync(file, extension);
            }

            // Check if we have a signature for this extension
            if (!FileSignatures.TryGetValue(extension, out var signatures))
            {
                // No signature defined - allow the file (extension validation already passed)
                return (true, null);
            }

            // Read the header bytes
            var maxSignatureLength = signatures.Max(s => s.Length);
            var minSignatureLength = signatures.Min(s => s.Length);
            var headerBytes = new byte[maxSignatureLength];
            var totalBytesRead = 0;

            using (var stream = file.OpenReadStream())
            {
                // Read header bytes, handling partial reads
                while (totalBytesRead < maxSignatureLength)
                {
                    var bytesRead = await stream.ReadAsync(
                        headerBytes.AsMemory(totalBytesRead, maxSignatureLength - totalBytesRead));
                    if (bytesRead == 0)
                    {
                        break; // EOF
                    }

                    totalBytesRead += bytesRead;
                }

                if (totalBytesRead < minSignatureLength)
                {
                    return (false, $"File too small to be a valid {extension} file");
                }
            }

            // Check if any signature matches
            var matchesSignature = signatures.Any(signature =>
                headerBytes.Take(signature.Length).SequenceEqual(signature));

            if (!matchesSignature)
            {
                return (false, $"File content does not match {extension} format. The file may be corrupted or have an incorrect extension.");
            }

            return (true, null);
        }

        /// <summary>
        /// Gets the normalized file extension, handling compound extensions like .fits.gz.
        /// </summary>
        private static string GetNormalizedExtension(string fileName)
        {
            // Handle compound extensions
            if (fileName.EndsWith(".fits.gz", StringComparison.Ordinal))
            {
                return ".fits.gz";
            }

            return Path.GetExtension(fileName);
        }

        /// <summary>
        /// Validates text file content (CSV, JSON).
        /// </summary>
        private static async Task<(bool IsValid, string? ErrorMessage)> ValidateTextFileAsync(IFormFile file, string extension)
        {
            try
            {
                // Read a sample of the file (first 8KB should be enough to validate structure)
                const int sampleSize = 8192;
                var bufferSize = (int)Math.Min(sampleSize, file.Length);

                using var memoryStream = new MemoryStream();
                using (var stream = file.OpenReadStream())
                {
                    // Copy to memory stream (handles partial reads correctly)
                    var buffer = new byte[bufferSize];
                    var totalRead = 0;
                    int bytesRead;
                    while (totalRead < bufferSize &&
                           (bytesRead = await stream.ReadAsync(buffer.AsMemory(totalRead, bufferSize - totalRead))) > 0)
                    {
                        totalRead += bytesRead;
                    }

                    memoryStream.Write(buffer, 0, totalRead);
                }

                var content = Encoding.UTF8.GetString(memoryStream.ToArray());

                // Check for binary content (null bytes indicate binary file)
                if (content.Contains('\0'))
                {
                    return (false, $"File appears to be binary, not a valid {extension} text file");
                }

                return extension switch
                {
                    ".json" => ValidateJsonContent(content),
                    ".csv" => ValidateCsvContent(content),
                    _ => (true, null),
                };
            }
            catch (Exception ex)
            {
                return (false, $"Error validating file content: {ex.Message}");
            }
        }

        /// <summary>
        /// Validates JSON content structure.
        /// </summary>
        private static (bool IsValid, string? ErrorMessage) ValidateJsonContent(string content)
        {
            try
            {
                // Attempt to parse as JSON
                using var doc = JsonDocument.Parse(content);
                return (true, null);
            }
            catch (JsonException)
            {
                // For partial content (truncated sample), check if it starts with valid JSON
                var trimmed = content.TrimStart();
                if (trimmed.StartsWith('{') || trimmed.StartsWith('['))
                {
                    // Looks like JSON structure, accept it (full validation would need complete file)
                    return (true, null);
                }

                return (false, "File does not contain valid JSON content");
            }
        }

        /// <summary>
        /// Validates CSV content structure.
        /// </summary>
        private static (bool IsValid, string? ErrorMessage) ValidateCsvContent(string content)
        {
            // Basic CSV validation:
            // 1. Should have at least one line
            // 2. Lines should have consistent delimiter patterns
            // 3. Should not start with suspicious patterns
            var lines = content.Split(['\n', '\r'], StringSplitOptions.RemoveEmptyEntries);

            if (lines.Length == 0)
            {
                return (false, "CSV file appears to be empty");
            }

            // Check for common delimiters in the first line
            var firstLine = lines[0];
            var hasComma = firstLine.Contains(',');
            var hasSemicolon = firstLine.Contains(';');
            var hasTab = firstLine.Contains('\t');

            if (!hasComma && !hasSemicolon && !hasTab)
            {
                // Single column CSV is valid but unusual - warn but accept
                return (true, null);
            }

            // Check that subsequent lines have similar structure (if we have multiple lines)
            if (lines.Length > 1)
            {
                var delimiter = hasComma ? ',' : (hasSemicolon ? ';' : '\t');
                var expectedColumns = firstLine.Split(delimiter).Length;

                // Check a sample of lines (not all, as file might be truncated)
                var samplesToCheck = Math.Min(10, lines.Length);
                for (var i = 1; i < samplesToCheck; i++)
                {
                    var columns = lines[i].Split(delimiter).Length;

                    // Allow some variance (quoted fields can contain delimiters)
                    if (columns < expectedColumns / 2 || columns > expectedColumns * 2)
                    {
                        return (false, "CSV file has inconsistent column structure");
                    }
                }
            }

            return (true, null);
        }
    }
}
