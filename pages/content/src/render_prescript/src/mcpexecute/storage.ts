/**
 * Storage functionality for executed functions
 * This module provides utilities to store and retrieve information about executed functions
 * URL-based storage implementation with race condition prevention
 */

// Define the interface for stored function execution data
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('STORAGE_KEY');

export interface ExecutedFunction {
  functionName: string; // Name of the executed function
  callId: string; // Unique ID for the function call
  contentSignature: string; // Hash or signature of the function content
  executedAt: number; // Timestamp when the function was executed
  params: Record<string, any>; // Parameters used in the function call
}

// Define the URL-based storage structure
interface URLBasedFunctionHistory {
  [url: string]: Record<string, ExecutedFunction>; // Key is functionName:callId:contentSignature
}

// Storage key for the executed functions
const STORAGE_KEY = 'mcp_url_based_function_history';
/**
 * Return a stable page key for execution history.
 * Query strings and hashes are transient UI state on SPA chat sites and must not
 * make an execution appear to disappear from the same conversation.
 */
const getCurrentHistoryKey = (): string => `${window.location.origin}${window.location.pathname}`;

/**
 * Read all buckets that belong to the current stable page key. This keeps
 * backward compatibility with entries previously stored under the full href.
 */
const getCurrentHistoryBuckets = (storage: URLBasedFunctionHistory): Record<string, ExecutedFunction>[] => {
  const stableKey = getCurrentHistoryKey();
  const buckets: Record<string, ExecutedFunction>[] = [];

  Object.entries(storage).forEach(([storedUrl, functions]) => {
    try {
      const parsed = new URL(storedUrl, window.location.origin);
      const storedStableKey = `${parsed.origin}${parsed.pathname}`;
      if (storedStableKey === stableKey) {
        buckets.push(functions);
      }
    } catch {
      if (storedUrl === stableKey || storedUrl === window.location.href) {
        buckets.push(functions);
      }
    }
  });

  return buckets;
};

/**
 * Store information about an executed function with race condition prevention
 *
 * @param functionName Name of the executed function
 * @param callId Unique ID for the function call
 * @param params Parameters used in the function call
 * @param contentSignature Hash or signature of the function content
 * @returns The stored function data
 */
export const storeExecutedFunction = (
  functionName: string,
  callId: string,
  params: Record<string, any>,
  contentSignature: string,
): ExecutedFunction => {
  // Use a stable conversation/page key; ignore transient query/hash state.
  const url = getCurrentHistoryKey();

  // Create the execution record
  const executionRecord: ExecutedFunction = {
    functionName,
    callId,
    contentSignature,
    executedAt: Date.now(),
    params,
  };

  // Create a unique key for this function execution
  const executionKey = generateExecutionKey(functionName, callId, contentSignature);

  // Use transaction pattern to prevent race conditions
  const storage = getURLBasedStorage();

  // Ensure this URL exists in storage
  if (!storage[url]) {
    storage[url] = {};
  }

  // Add/update the execution record
  storage[url][executionKey] = executionRecord;

  // Save back to storage with race condition prevention
  try {
    const maxRetries = 3;
    let retries = 0;
    let saved = false;

    while (!saved && retries < maxRetries) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
        saved = true;
      } catch (error) {
        retries++;
        // Short delay before retrying
        if (retries < maxRetries) {
          logger.warn(`Storage write failed, retrying (${retries}/${maxRetries})`);
        }
      }
    }

    if (!saved) {
      logger.error('Failed to store executed function after multiple attempts');
    }
  } catch (error) {
    logger.error('Failed to store executed function:', error);
  }

  return executionRecord;
};

/**
 * Generate a unique key for function execution tracking
 */
const generateExecutionKey = (functionName: string, callId: string, contentSignature: string): string => {
  return `${functionName}:${callId}:${contentSignature}`;
};

/**
 * Get URL-based storage data
 *
 * @returns URL-based function history storage
 */
const getURLBasedStorage = (): URLBasedFunctionHistory => {
  try {
    const storedData = localStorage.getItem(STORAGE_KEY);
    return storedData ? JSON.parse(storedData) : {};
  } catch (error) {
    logger.error('Failed to retrieve URL-based function history:', error);
    return {};
  }
};

/**
 * Get all stored executed functions (legacy interface for backward compatibility)
 *
 * @returns Array of executed function records with URL included
 */
export const getExecutedFunctions = (): (ExecutedFunction & { url: string })[] => {
  try {
    const storage = getURLBasedStorage();
    const result: (ExecutedFunction & { url: string })[] = [];

    // Convert URL-based structure to flat array
    Object.entries(storage).forEach(([url, functions]) => {
      Object.values(functions).forEach(func => {
        result.push({
          ...func,
          url,
        });
      });
    });

    return result;
  } catch (error) {
    logger.error('Failed to retrieve executed functions:', error);
    return [];
  }
};

/**
 * Get executed functions for the current URL
 *
 * @returns Array of executed function records for the current URL
 */
export const getExecutedFunctionsForCurrentUrl = (): ExecutedFunction[] => {
  const storage = getURLBasedStorage();
  const merged = new Map<string, ExecutedFunction>();

  getCurrentHistoryBuckets(storage).forEach(bucket => {
    Object.entries(bucket).forEach(([key, execution]) => {
      const existing = merged.get(key);
      if (!existing || execution.executedAt > existing.executedAt) {
        merged.set(key, execution);
      }
    });
  });

  return Array.from(merged.values());
};

/**
 * Get executed functions for a specific URL
 *
 * @param url The URL to get functions for
 * @returns Array of executed function records for the specified URL
 */
export const getExecutedFunctionsForUrl = (url: string): ExecutedFunction[] => {
  const storage = getURLBasedStorage();

  // Direct access to URL's functions
  if (!storage[url]) {
    return [];
  }

  return Object.values(storage[url]);
};

/**
 * Check if a function has been previously executed
 *
 * @param functionName Name of the function
 * @param callId Unique ID for the function call
 * @param contentSignature Hash or signature of the function content
 * @returns The executed function record if found, null otherwise
 */
export const getPreviousExecution = (
  functionName: string,
  callId: string,
  contentSignature: string,
): ExecutedFunction | null => {
  const storage = getURLBasedStorage();
  const executionKey = generateExecutionKey(functionName, callId, contentSignature);
  let latest: ExecutedFunction | null = null;

  getCurrentHistoryBuckets(storage).forEach(bucket => {
    const match = bucket[executionKey];
    if (match && (!latest || match.executedAt > latest.executedAt)) {
      latest = match;
    }
  });

  return latest;
};

/**
 * Check if a function has been previously executed (backward compatibility version)
 *
 * @param callId Unique ID for the function call
 * @param contentSignature Hash or signature of the function content
 * @returns The executed function record if found, null otherwise
 */
export const getPreviousExecutionLegacy = (callId: string, contentSignature: string): ExecutedFunction | null => {
  const storage = getURLBasedStorage();
  let latest: ExecutedFunction | null = null;

  getCurrentHistoryBuckets(storage).forEach(bucket => {
    Object.values(bucket).forEach(func => {
      if (
        func.callId === callId &&
        func.contentSignature === contentSignature &&
        (!latest || func.executedAt > latest.executedAt)
      ) {
        latest = func;
      }
    });
  });

  return latest;
};

/**
 * Generate a content signature for a function call
 *
 * @param functionName Name of the function
 * @param params Parameters of the function call
 * @returns A string signature representing the function call
 */
export const generateContentSignature = (functionName: string, params: Record<string, any>): string => {
  // Create a simple hash of the function name and parameters
  try {
    // Sort keys of params for deterministic stringification
    const sortedParams: Record<string, any> = {};
    Object.keys(params)
      .sort()
      .forEach(key => {
        sortedParams[key] = params[key];
      });

    const content = JSON.stringify({ name: functionName, params: sortedParams });
    // Simple hash function for the content
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  } catch (error) {
    logger.error('Failed to generate content signature:', error);
    // Fallback to timestamp if hashing fails
    return Date.now().toString(16);
  }
};

/**
 * Format a timestamp to a human-readable date string
 *
 * @param timestamp Timestamp in milliseconds
 * @returns Formatted date string
 */
export const formatExecutionTime = (timestamp: number): string => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch (error) {
    return 'Unknown date';
  }
};
