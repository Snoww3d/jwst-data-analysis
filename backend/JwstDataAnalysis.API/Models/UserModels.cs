// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.ComponentModel.DataAnnotations;

using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// User role constants.
    /// </summary>
    public static class UserRoles
    {
        public const string Admin = "Admin";
        public const string User = "User";

        public static readonly string[] AllRoles = [Admin, User];

        public static bool IsValidRole(string role) => AllRoles.Contains(role, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// User document stored in MongoDB.
    /// </summary>
    public class User
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string Id { get; set; } = string.Empty;

        [Required]
        [StringLength(50, MinimumLength = 3)]
        public string Username { get; set; } = string.Empty;

        [Required]
        [EmailAddress]
        [StringLength(255)]
        public string Email { get; set; } = string.Empty;

        [Required]
        public string PasswordHash { get; set; } = string.Empty;

        [Required]
        public string Role { get; set; } = UserRoles.User;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public DateTime? LastLoginAt { get; set; }

        public bool IsActive { get; set; } = true;

        // Refresh token for token rotation
        public string? RefreshToken { get; set; }

        public DateTime? RefreshTokenExpiresAt { get; set; }

        // Optional profile fields
        public string? DisplayName { get; set; }

        public string? Organization { get; set; }
    }
}
