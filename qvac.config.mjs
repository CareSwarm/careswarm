/**
 * QVAC SDK configuration (auto-loaded from project root).
 * cacheDirectory holds built-in model downloads (gitignored). Override with
 * QVAC_CACHE_DIR to keep them on an external drive if your disk is tight.
 */
export default {
  cacheDirectory: process.env.QVAC_CACHE_DIR ?? './.qvac-cache',
  loggerLevel: process.env.QVAC_LOG_LEVEL ?? 'warn',
  loggerConsoleOutput: true,
};
