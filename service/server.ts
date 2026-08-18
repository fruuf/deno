import { firstValueFrom } from "npm:rxjs";
import { cacheHandler } from "../cache.ts";
import { swallowError } from "../error.ts";
import {
  addShutdownCleanupHandler,
  isStartupCompleteStream,
  isTestModeEnabled,
  TEST_SERVICE_PORT,
} from "./lifecycle.ts";
import { isShutdownStream } from "./signals.ts";

/**
 * Creates health check server with /live and /ready endpoints.
 */
export const createServer = cacheHandler(
  null,
  swallowError(() => {
    const port = isTestModeEnabled ? TEST_SERVICE_PORT : 8080;
    const server = Deno.serve(
      { port, hostname: "0.0.0.0" },
      async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/live") {
          const isShutdown = await firstValueFrom(isShutdownStream);
          if (isShutdown) {
            return new Response("", { status: 400 });
          }
          return new Response("", { status: 200 });
        }
        if (url.pathname === "/ready") {
          const [isStartupComplete, isShutdown] = await Promise.all([
            firstValueFrom(isStartupCompleteStream),
            firstValueFrom(isShutdownStream),
          ]);
          if (isStartupComplete && !isShutdown) {
            return new Response("", { status: 200 });
          }
          return new Response("", { status: 400 });
        }
        return new Response("", { status: 404 });
      },
    );
    addShutdownCleanupHandler(async () => {
      await server.shutdown();
    });
  }),
);
