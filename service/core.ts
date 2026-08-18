import { filter, firstValueFrom } from "npm:rxjs";
import { errorHandler } from "../error.ts";
import { logger } from "../log.ts";
import {
  addStartupSetupHandler,
  isStartupCompleteStream,
} from "./lifecycle.ts";
import { createServer } from "./server.ts";
import { shutdownSignalSubject } from "./signals.ts";

/**
 * Creates main service with startup handlers and server initialization.
 */
export async function createService(
  handler: (
    ...args: string[]
  ) => Promise<void> | void,
) {
  addStartupSetupHandler(createServer);
  addStartupSetupHandler(async () => {
    try {
      await handler();
    } catch (e) {
      const handledError = errorHandler(e);
      logger.info("service_start_error", { error: handledError.message });
      shutdownSignalSubject.next({ reason: "CREATE_SERVICE_ERROR", code: 1 });
    }
  });
  await firstValueFrom(
    isStartupCompleteStream.pipe(
      filter((isComplete) => isComplete),
    ),
  );
  logger.info("service_started");
}
