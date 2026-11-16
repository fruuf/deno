import { expect } from "jsr:@std/expect";
import { describe, it } from "jsr:@std/testing/bdd";
import { firstValueFrom } from "npm:rxjs";
import {
  addShutdownCleanupHandler,
  completeHandlerBeforeShutdown,
  createService,
  exitStream,
  triggerShutdown,
} from "./service.ts";
import { wait } from "./util.ts";

describe("service", () => {
  it("creates service", async () => {
    const start = Date.now();
    const events: [time: number, event: string][] = [];
    async function event(event: string, delay: number) {
      await wait(delay * 1e2);
      const now = Date.now();
      const time = Math.round((now - start) * 1e-2);
      events.push([time, event]);
    }

    addShutdownCleanupHandler(async () => {
      event("cleanup0", 0);
      await event("cleanup10", 10);
    });

    addShutdownCleanupHandler(async () => {
      event("cleanup5", 5);
      await event("cleanup15", 15);
    });

    const handler = completeHandlerBeforeShutdown(
      async (name: string, delay: number) => {
        await event(name, delay);
      },
    );

    await createService(async () => {
      event("create0", 0);
      await event("create10", 10);
    });

    // await checkHealth();

    handler("handler0", 0);
    handler("handler10", 10);
    handler("handler5", 5);
    handler("handler15", 15);

    triggerShutdown();

    await firstValueFrom(exitStream);

    expect(events).toEqual([
      // first column is time in 100ms
      [0, "create0"],
      [10, "create10"],
      [20, "handler0"],
      [25, "handler5"],
      [30, "handler10"],
      [35, "handler15"],
      [45, "cleanup0"],
      [50, "cleanup5"],
      [55, "cleanup10"],
      [60, "cleanup15"],
    ]);
  });
});
