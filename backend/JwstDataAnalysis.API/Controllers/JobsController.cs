// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// Unified job management endpoints for all async operations.
    /// All endpoints enforce job ownership via the authenticated user's ID.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class JobsController(
        IJobTracker jobTracker,
        IStorageProvider storageProvider) : ControllerBase
    {
        private readonly IJobTracker jobTracker = jobTracker;
        private readonly IStorageProvider storageProvider = storageProvider;

        /// <summary>
        /// List the authenticated user's jobs, optionally filtered by status and type.
        /// </summary>
        /// <param name="status">Filter by state (queued, running, completed, failed, cancelled).</param>
        /// <param name="type">Filter by job type (import, composite, mosaic).</param>
        /// <returns>List of job statuses.</returns>
        [HttpGet]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        public async Task<IActionResult> ListJobs([FromQuery] string? status = null, [FromQuery] string? type = null)
        {
            var userId = GetUserId();
            if (userId is null)
            {
                return Unauthorized();
            }

            var jobs = await jobTracker.GetJobsForUserAsync(userId, status, type);
            return Ok(jobs);
        }

        /// <summary>
        /// Get a single job's status. Used as polling fallback when SignalR is unavailable.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <returns>Job status or 404.</returns>
        [HttpGet("{jobId}")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> GetJob(string jobId)
        {
            var userId = GetUserId();
            if (userId is null)
            {
                return Unauthorized();
            }

            var job = await jobTracker.GetJobAsync(jobId, userId);
            if (job is null)
            {
                return NotFound();
            }

            return Ok(job);
        }

        /// <summary>
        /// Cancel a job. Only the owner can cancel.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <returns>204 on success, 404 if not found or not cancellable.</returns>
        [HttpPost("{jobId}/cancel")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> CancelJob(string jobId)
        {
            var userId = GetUserId();
            if (userId is null)
            {
                return Unauthorized();
            }

            var cancelled = await jobTracker.CancelJobAsync(jobId, userId);
            if (!cancelled)
            {
                return NotFound();
            }

            return NoContent();
        }

        /// <summary>
        /// Stream the blob result of a completed job. Resets the TTL on access.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <returns>File stream or 404.</returns>
        [HttpGet("{jobId}/result")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> GetResult(string jobId)
        {
            var userId = GetUserId();
            if (userId is null)
            {
                return Unauthorized();
            }

            var job = await jobTracker.GetJobAsync(jobId, userId);
            if (job is null)
            {
                return NotFound();
            }

            if (job.State != Models.JobStates.Completed)
            {
                return BadRequest(new { error = "Job is not completed", state = job.State });
            }

            if (job.ResultKind == Models.ResultKinds.DataId)
            {
                await jobTracker.RecordResultAccessAsync(jobId);
                return Ok(new { resultKind = "data_id", dataId = job.ResultDataId });
            }

            if (job.ResultStorageKey is null)
            {
                return NotFound(new { error = "No result available for this job" });
            }

            // Extend TTL on access
            await jobTracker.RecordResultAccessAsync(jobId);

            var exists = await storageProvider.ExistsAsync(job.ResultStorageKey);
            if (!exists)
            {
                return NotFound(new { error = "Result file has expired or been cleaned up" });
            }

            var stream = await storageProvider.ReadStreamAsync(job.ResultStorageKey);
            return File(stream, job.ResultContentType ?? "application/octet-stream", job.ResultFilename);
        }

        private string? GetUserId() =>
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
    }
}
