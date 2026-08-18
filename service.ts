/**
 * Service lifecycle management with startup/shutdown handling and health checks.
 * Entry point that re-exports public APIs from individual service modules.
 */

// Core lifecycle exports
export {
  addShutdownCleanupHandler,
  addStartupSetupHandler,
  isProductionModeEnabled,
  isTestModeEnabled,
  TEST_HTTP_PORT,
  TEST_IDENTIFIER,
  TEST_SERVICE_PORT,
  withTestIdentifier,
} from "./service/lifecycle.ts";

// Signal handling exports
export {
  cleanupStream,
  exitStream,
  isShutdown,
  shutdownStream,
  triggerShutdown,
} from "./service/signals.ts";

// Handler management exports
export {
  completeHandlerBeforeShutdown,
  completePromiseBeforeShutdown,
  subscribeUntilComplete,
} from "./service/handlers.ts";

// Utility exports
export { intervalUntilShutdown, repeatUntilShutdown } from "./service/utils.ts";

// Core service exports
export { createService } from "./service/core.ts";

// Testing exports
export { testDependencies } from "./service/testing.ts";
