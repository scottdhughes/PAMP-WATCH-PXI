import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8787';
const POLL_INTERVAL = 60000; // 60 seconds
const STALE_THRESHOLD = 180000; // 3 minutes (3 missed intervals)
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds

export interface DashboardSnapshot {
  version: string;
  pxi: number;
  statusLabel: string;
  zScore: number;
  calculatedAt: string;
  metrics: any[];
  ticker: string[];
  alerts?: any[];
  regime?: any;
}

export interface SnapshotState {
  data: DashboardSnapshot | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdate: Date | null;
  timeSinceUpdate: number | null; // seconds
  isStale: boolean;
  retryCount: number;
}

/**
 * Custom hook for polling dashboard snapshot with version-based change detection
 *
 * Features:
 * - 60-second polling interval
 * - Atomic updates (only when version changes)
 * - Exponential backoff on failures (2s, 4s, 8s)
 * - Stale indicator after 3 missed intervals (180s)
 * - Automatic retry logic with max 3 attempts
 */
export function useDashboardSnapshot() {
  const [state, setState] = useState<SnapshotState>({
    data: null,
    isLoading: true,
    error: null,
    lastUpdate: null,
    timeSinceUpdate: null,
    isStale: false,
    retryCount: 0,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastVersionRef = useRef<string | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Fetch snapshot from API with retry logic
   */
  const fetchSnapshot = useCallback(async (retryCount = 0): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE}/v1/snapshot`, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const snapshot: DashboardSnapshot = await response.json();

      // Only update state if version has changed (atomic update)
      const versionChanged = lastVersionRef.current !== snapshot.version;

      if (versionChanged || retryCount > 0) {
        // Update version ref
        lastVersionRef.current = snapshot.version;

        // Update state
        setState({
          data: snapshot,
          isLoading: false,
          error: null,
          lastUpdate: new Date(),
          timeSinceUpdate: 0,
          isStale: false,
          retryCount: 0,
        });

        if (versionChanged) {
          console.log(`[Snapshot] Updated to version ${snapshot.version}`);
        }
      } else {
        // No version change, just update timestamps
        setState((prev) => ({
          ...prev,
          lastUpdate: new Date(),
          timeSinceUpdate: 0,
          isStale: false,
          retryCount: 0,
        }));
        console.log(`[Snapshot] No changes detected (version ${snapshot.version})`);
      }
    } catch (error) {
      const err = error as Error;
      console.error(`[Snapshot] Fetch failed (attempt ${retryCount + 1}/${MAX_RETRIES}):`, err.message);

      // Implement exponential backoff
      if (retryCount < MAX_RETRIES - 1) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
        console.log(`[Snapshot] Retrying in ${delay}ms...`);

        retryTimeoutRef.current = setTimeout(() => {
          fetchSnapshot(retryCount + 1);
        }, delay);
      } else {
        // Max retries reached
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err,
          retryCount: retryCount + 1,
        }));
        console.error(`[Snapshot] Max retries reached, giving up`);
      }
    }
  }, []);

  /**
   * Update timeSinceUpdate counter every second
   */
  useEffect(() => {
    const timer = setInterval(() => {
      setState((prev) => {
        if (!prev.lastUpdate) return prev;

        const now = new Date();
        const timeSinceUpdate = Math.floor((now.getTime() - prev.lastUpdate.getTime()) / 1000);
        const isStale = timeSinceUpdate > (STALE_THRESHOLD / 1000);

        return {
          ...prev,
          timeSinceUpdate,
          isStale,
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  /**
   * Start polling on mount
   */
  useEffect(() => {
    console.log(`[Snapshot] Starting 60s polling (stale threshold: ${STALE_THRESHOLD / 1000}s)`);

    // Fetch immediately on mount
    fetchSnapshot();

    // Set up polling interval
    pollIntervalRef.current = setInterval(() => {
      fetchSnapshot();
    }, POLL_INTERVAL);

    // Cleanup on unmount
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      console.log('[Snapshot] Polling stopped');
    };
  }, [fetchSnapshot]);

  return state;
}
