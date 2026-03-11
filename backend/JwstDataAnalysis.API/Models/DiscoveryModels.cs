// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// A curated featured target displayed on the discovery home page.
    /// </summary>
    public class FeaturedTarget
    {
        /// <summary>Gets or sets the common name (e.g. "Carina Nebula").</summary>
        public required string Name { get; set; }

        /// <summary>Gets or sets the catalog identifier (e.g. "NGC 3372").</summary>
        public required string CatalogId { get; set; }

        /// <summary>Gets or sets the category for grouping: nebula, galaxy, planetary, cluster.</summary>
        public required string Category { get; set; }

        /// <summary>Gets or sets the short description for the card UI.</summary>
        public required string Description { get; set; }

        /// <summary>Gets or sets the instruments known to have data for this target.</summary>
        public required List<string> Instruments { get; set; }

        /// <summary>Gets or sets the approximate number of unique filters available.</summary>
        public int FilterCount { get; set; }

        /// <summary>Gets or sets the composite potential: great, good, or limited.</summary>
        public required string CompositePotential { get; set; }

        /// <summary>Gets or sets an optional thumbnail URL.</summary>
        public string? Thumbnail { get; set; }

        /// <summary>Gets or sets the parameters to pass to MAST search for this target.</summary>
        public required MastSearchParams MastSearchParams { get; set; }
    }

    /// <summary>
    /// Parameters for searching MAST observations of a featured target.
    /// </summary>
    public class MastSearchParams
    {
        /// <summary>Gets or sets the target name to search for.</summary>
        public required string Target { get; set; }

        /// <summary>Gets or sets the instrument filter (e.g. "NIRCAM", "MIRI").</summary>
        public string? Instrument { get; set; }

        /// <summary>Gets or sets the product level (e.g. "2b").</summary>
        public string? ProductLevel { get; set; }

        /// <summary>Gets or sets the search radius override in degrees for wide-field targets.</summary>
        public double? SearchRadius { get; set; }
    }

    /// <summary>
    /// Request body for the suggest-recipes endpoint.
    /// </summary>
    public class SuggestRecipesRequestDto
    {
        /// <summary>Gets or sets the target name to search and generate recipes for.</summary>
        public string? TargetName { get; set; }

        /// <summary>
        /// Gets or sets the pre-fetched observations to generate recipes from.
        /// If provided, skips the MAST search step.
        /// </summary>
        public List<ObservationDto>? Observations { get; set; }
    }

    /// <summary>
    /// A simplified observation for recipe generation input.
    /// </summary>
    public class ObservationDto
    {
        /// <summary>Gets or sets the filter name (e.g. "F444W").</summary>
        public required string Filter { get; set; }

        /// <summary>Gets or sets the instrument name (e.g. "NIRCAM").</summary>
        public required string Instrument { get; set; }

        /// <summary>Gets or sets the wavelength in micrometers.</summary>
        public double? WavelengthUm { get; set; }

        /// <summary>Gets or sets the observation ID for MAST.</summary>
        public string? ObservationId { get; set; }

        /// <summary>Gets or sets the data release date in Modified Julian Date.</summary>
        public double? TObsRelease { get; set; }

        /// <summary>Gets or sets the MAST data product type (e.g. "image", "spectrum").</summary>
        public string? DataProductType { get; set; }

        /// <summary>Gets or sets the right ascension of the observation center (degrees).</summary>
        public double? SRa { get; set; }

        /// <summary>Gets or sets the declination of the observation center (degrees).</summary>
        public double? SDec { get; set; }
    }

    /// <summary>
    /// Response from the Python recipe engine.
    /// </summary>
    public class SuggestRecipesResponseDto
    {
        /// <summary>Gets or sets the target metadata.</summary>
        public TargetInfoDto? Target { get; set; }

        /// <summary>Gets or sets the ranked list of composite recipes.</summary>
        public required List<RecipeDto> Recipes { get; set; }
    }

    /// <summary>
    /// Basic target information returned with recipes.
    /// </summary>
    public class TargetInfoDto
    {
        /// <summary>Gets or sets the target name.</summary>
        public string? Name { get; set; }

        /// <summary>Gets or sets the common name.</summary>
        public string? CommonName { get; set; }

        /// <summary>Gets or sets the right ascension.</summary>
        public double? Ra { get; set; }

        /// <summary>Gets or sets the declination.</summary>
        public double? Dec { get; set; }

        /// <summary>Gets or sets the category.</summary>
        public string? Category { get; set; }
    }

    /// <summary>
    /// A composite recipe suggestion.
    /// </summary>
    public class RecipeDto
    {
        /// <summary>Gets or sets the recipe display name (e.g. "6-filter NIRCam").</summary>
        public required string Name { get; set; }

        /// <summary>Gets or sets the rank (1 = recommended).</summary>
        public int Rank { get; set; }

        /// <summary>Gets or sets the list of filter names in this recipe.</summary>
        public required List<string> Filters { get; set; }

        /// <summary>Gets or sets the color mapping: filter name to hex color string.</summary>
        public required Dictionary<string, string> ColorMapping { get; set; }

        /// <summary>Gets or sets the instruments used.</summary>
        public required List<string> Instruments { get; set; }

        /// <summary>Gets or sets a value indicating whether mosaic is needed (multiple pointings).</summary>
        public bool RequiresMosaic { get; set; }

        /// <summary>Gets or sets the estimated processing time in seconds.</summary>
        public int EstimatedTimeSeconds { get; set; }

        /// <summary>Gets or sets the observation IDs to use.</summary>
        public List<string>? ObservationIds { get; set; }

        /// <summary>Gets or sets a short description of what this recipe highlights.</summary>
        public string? Description { get; set; }

        /// <summary>Gets or sets a warning about spatial overlap issues.</summary>
        public string? OverlapWarning { get; set; }

        /// <summary>Gets or sets an optional badge tag for the recipe (e.g. "NASA-style").</summary>
        public string? Tag { get; set; }
    }
}
