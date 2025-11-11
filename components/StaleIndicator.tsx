import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface StaleIndicatorProps {
  isStale: boolean;
  timeSinceUpdate: number | null; // seconds
  lastUpdate: Date | null;
  error: Error | null;
  retryCount: number;
}

/**
 * Displays data staleness warning when updates are delayed
 *
 * Shows:
 * - Green dot + "Live" when fresh (< 180s)
 * - Yellow dot + "Stale (mm:ss)" when delayed (≥ 180s)
 * - Red dot + error message when failed
 */
export function StaleIndicator({
  isStale,
  timeSinceUpdate,
  lastUpdate,
  error,
  retryCount,
}: StaleIndicatorProps) {
  // Format seconds as mm:ss
  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine status
  const status = error
    ? 'error'
    : isStale
    ? 'stale'
    : 'live';

  const statusConfig = {
    live: {
      color: 'bg-green-500',
      textColor: 'text-green-400',
      label: 'Live',
      icon: '●',
    },
    stale: {
      color: 'bg-yellow-500',
      textColor: 'text-yellow-400',
      label: `Stale (${timeSinceUpdate !== null ? formatTime(timeSinceUpdate) : 'N/A'})`,
      icon: '⚠',
    },
    error: {
      color: 'bg-red-500',
      textColor: 'text-red-400',
      label: `Error (${retryCount} retries)`,
      icon: '✕',
    },
  };

  const config = statusConfig[status];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className={`flex items-center gap-2 text-xs ${config.textColor}`}
      >
        {/* Status dot with pulse animation */}
        <div className="relative flex items-center justify-center">
          <span
            className={`inline-block w-2 h-2 rounded-full ${config.color}`}
          />
          {status === 'live' && (
            <span
              className={`absolute inline-flex h-full w-full rounded-full ${config.color} opacity-75 animate-ping`}
            />
          )}
        </div>

        {/* Status label */}
        <span className="font-medium">{config.label}</span>

        {/* Last update timestamp (tooltip-like info) */}
        {lastUpdate && status !== 'error' && (
          <span className="text-slate-600 text-[10px]">
            {lastUpdate.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        )}

        {/* Error message */}
        {error && (
          <span className="text-slate-600 text-[10px] max-w-[200px] truncate">
            {error.message}
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
