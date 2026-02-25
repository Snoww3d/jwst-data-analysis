/**
 * Job progress types for SignalR real-time updates and REST polling fallback.
 *
 * These mirror the backend Models/JobProgressModels.cs DTOs.
 */

/** Sent via SignalR when a job's progress updates. */
export interface JobProgressUpdate {
  jobId: string;
  jobType: string;
  state: string;
  progressPercent: number;
  stage?: string;
  message?: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

/** Sent via SignalR when a job completes successfully. */
export interface JobCompletionUpdate {
  jobId: string;
  jobType: string;
  state: 'completed';
  message?: string;
  completedAt: string;
  expiresAt: string;
  resultKind?: 'blob' | 'data_id';
  resultContentType?: string;
  resultFilename?: string;
  resultDataId?: string;
}

/** Sent via SignalR when a job fails. */
export interface JobFailureUpdate {
  jobId: string;
  jobType: string;
  state: 'failed';
  error: string;
  failedAt: string;
}

/** Full job snapshot sent on SignalR reconnect. */
export interface JobSnapshotUpdate {
  jobId: string;
  jobType: string;
  state: string;
  description?: string;
  progressPercent: number;
  stage?: string;
  message?: string;
  error?: string;
  cancelRequested: boolean;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt?: string;
  resultKind?: 'blob' | 'data_id';
  resultContentType?: string;
  resultFilename?: string;
  resultDataId?: string;
  metadata?: Record<string, unknown>;
}

/** Union of all job update types for event handlers. */
export type JobUpdate =
  | JobProgressUpdate
  | JobCompletionUpdate
  | JobFailureUpdate
  | JobSnapshotUpdate;

/** Job states matching the backend state machine. */
export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
