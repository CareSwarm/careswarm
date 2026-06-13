// QVAC SDK config (auto-loaded from project root).
// QVAC requires an absolute cacheDirectory; when QVAC_CACHE_DIR is unset we
// omit it so the SDK uses its default (~/.qvac). Set QVAC_CACHE_DIR to an
// external drive if your main disk is tight.
import path from 'node:path';

const cacheDir = process.env.QVAC_CACHE_DIR
  ? path.resolve(process.env.QVAC_CACHE_DIR)
  : undefined;

export default {
  ...(cacheDir ? { cacheDirectory: cacheDir } : {}),
  loggerLevel: process.env.QVAC_LOG_LEVEL ?? 'warn',
  loggerConsoleOutput: true,
};
