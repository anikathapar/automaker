/**
 * Common utilities shared across all route modules
 */

import { createLogger } from '@automaker/utils';

// Re-export git utilities from shared package
export {
  BINARY_EXTENSIONS,
  GIT_STATUS_MAP,
  type FileStatus,
  isGitRepo,
  parseGitStatus,
  generateSyntheticDiffForNewFile,
  appendUntrackedFileDiffs,
  listAllFilesInDirectory,
  generateDiffsForNonGitDirectory,
  getGitRepositoryDiffs,
} from '@automaker/git-utils';

type Logger = ReturnType<typeof createLogger>;

/**
 * Get error message from error object
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Create a logError function for a specific logger
 * This ensures consistent error logging format across all routes
 */
export function createLogError(logger: Logger) {
  return (error: unknown, context: string): void => {
    logger.error(`❌ ${context}:`, error);
  };
}

/**
 * Express 5 types dynamic route params as string | string[]. Normalize to a single string.
 */
export function paramString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
