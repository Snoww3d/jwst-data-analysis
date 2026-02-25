/**
 * SignalR connection manager for real-time job progress updates.
 *
 * Manages a single HubConnection to /hubs/job-progress with:
 * - Automatic reconnect with exponential backoff
 * - Dynamic JWT token fetch on each connection/reconnect (handles token refresh)
 * - Per-job subscriptions that return cleanup functions
 * - Connection state tracking
 */

import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from '@microsoft/signalr';
import { API_BASE_URL } from '../config/api';
import type {
  JobProgressUpdate,
  JobCompletionUpdate,
  JobFailureUpdate,
  JobSnapshotUpdate,
} from '../types/JobTypes';

/** Callbacks for job progress events. */
export interface JobProgressCallbacks {
  onProgress?: (update: JobProgressUpdate) => void;
  onCompleted?: (update: JobCompletionUpdate) => void;
  onFailed?: (update: JobFailureUpdate) => void;
  onSnapshot?: (update: JobSnapshotUpdate) => void;
}

/** Connection state exposed to consumers. */
export type SignalRConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

type ConnectionStateListener = (state: SignalRConnectionState) => void;

// localStorage key matching AuthContext
const ACCESS_TOKEN_KEY = 'jwst_auth_token';

let connection: HubConnection | null = null;
const jobSubscriptions = new Map<string, Set<JobProgressCallbacks>>();
const stateListeners = new Set<ConnectionStateListener>();
let currentState: SignalRConnectionState = 'disconnected';

function notifyStateChange(state: SignalRConnectionState): void {
  currentState = state;
  for (const listener of stateListeners) {
    listener(state);
  }
}

/**
 * Get or create the SignalR hub connection.
 * Token is fetched dynamically on each connection attempt so expired tokens
 * are automatically replaced by fresh ones from the auth refresh flow.
 */
function getOrCreateConnection(): HubConnection {
  if (connection) return connection;

  connection = new HubConnectionBuilder()
    .withUrl(`${API_BASE_URL}/hubs/job-progress`, {
      accessTokenFactory: () => localStorage.getItem(ACCESS_TOKEN_KEY) ?? '',
    })
    .withAutomaticReconnect([0, 1000, 2000, 5000, 10000, 30000])
    .configureLogging(LogLevel.Warning)
    .build();

  // Wire up hub server events to subscription callbacks
  connection.on('JobProgress', (update: JobProgressUpdate) => {
    const subs = jobSubscriptions.get(update.jobId);
    if (subs) {
      for (const cb of subs) cb.onProgress?.(update);
    }
  });

  connection.on('JobCompleted', (update: JobCompletionUpdate) => {
    const subs = jobSubscriptions.get(update.jobId);
    if (subs) {
      for (const cb of subs) cb.onCompleted?.(update);
    }
  });

  connection.on('JobFailed', (update: JobFailureUpdate) => {
    const subs = jobSubscriptions.get(update.jobId);
    if (subs) {
      for (const cb of subs) cb.onFailed?.(update);
    }
  });

  connection.on('JobSnapshot', (update: JobSnapshotUpdate) => {
    const subs = jobSubscriptions.get(update.jobId);
    if (subs) {
      for (const cb of subs) cb.onSnapshot?.(update);
    }
  });

  // Connection lifecycle events
  connection.onreconnecting(() => notifyStateChange('reconnecting'));
  connection.onreconnected(() => {
    notifyStateChange('connected');
    // Re-subscribe to all active jobs after reconnect
    resubscribeAll();
  });
  connection.onclose(() => {
    notifyStateChange('disconnected');
    connection = null;
  });

  return connection;
}

/**
 * Re-subscribe to all active jobs after a reconnect.
 * This ensures the server adds us back to the correct SignalR groups.
 */
async function resubscribeAll(): Promise<void> {
  if (!connection || connection.state !== HubConnectionState.Connected) return;

  const jobIds = Array.from(jobSubscriptions.keys());
  for (const jobId of jobIds) {
    try {
      await connection.invoke('SubscribeToJob', jobId);
    } catch (err) {
      console.error(`[SignalR] Failed to resubscribe to job ${jobId}:`, err);
    }
  }
}

/**
 * Ensure the connection is started. No-op if already connected.
 */
async function ensureConnected(): Promise<void> {
  const conn = getOrCreateConnection();
  if (conn.state === HubConnectionState.Connected) return;
  if (
    conn.state === HubConnectionState.Connecting ||
    conn.state === HubConnectionState.Reconnecting
  ) {
    // Wait for the current connection attempt
    return;
  }

  notifyStateChange('connecting');
  try {
    await conn.start();
    notifyStateChange('connected');
  } catch (err) {
    notifyStateChange('disconnected');
    console.error('[SignalR] Connection failed:', err);
    throw err;
  }
}

/**
 * Subscribe to progress updates for a specific job.
 * Automatically connects if not already connected.
 *
 * @returns An unsubscribe function that cleans up the subscription.
 */
export async function subscribeToJob(
  jobId: string,
  callbacks: JobProgressCallbacks
): Promise<() => void> {
  // Register callbacks before connecting (so we don't miss events)
  let subs = jobSubscriptions.get(jobId);
  if (!subs) {
    subs = new Set();
    jobSubscriptions.set(jobId, subs);
  }
  subs.add(callbacks);

  try {
    await ensureConnected();
    if (connection) {
      await connection.invoke('SubscribeToJob', jobId);
    }
  } catch (err) {
    console.error(`[SignalR] Failed to subscribe to job ${jobId}:`, err);
    // Don't throw — the polling fallback in useJobProgress will handle this
  }

  // Return unsubscribe function
  return () => {
    const subs = jobSubscriptions.get(jobId);
    if (subs) {
      subs.delete(callbacks);
      if (subs.size === 0) {
        jobSubscriptions.delete(jobId);
        // Unsubscribe from server group
        if (connection?.state === HubConnectionState.Connected) {
          connection.invoke('UnsubscribeFromJob', jobId).catch(() => {
            // Ignore — connection may already be closing
          });
        }
      }
    }

    // If no more subscriptions, stop the connection
    if (jobSubscriptions.size === 0 && connection) {
      connection.stop().catch(() => {});
      connection = null;
      notifyStateChange('disconnected');
    }
  };
}

/**
 * Get the current connection state.
 */
export function getConnectionState(): SignalRConnectionState {
  return currentState;
}

/**
 * Listen for connection state changes.
 * @returns An unsubscribe function.
 */
export function onConnectionStateChange(listener: ConnectionStateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/**
 * Check if SignalR is currently connected.
 */
export function isConnected(): boolean {
  return connection?.state === HubConnectionState.Connected;
}
