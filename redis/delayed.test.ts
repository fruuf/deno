import { beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { uuid, wait } from "../util.ts";
import { redisDelayedHandler } from "./delayed.ts";
import { setupRedis } from "./redis.ts";

describe("scheduler", () => {
  beforeEach(async () => {
    await setupRedis("test");
  });

  it("delayed handler", async () => {
    const handler = redisDelayedHandler(
      "test",
      "test",
      // deno-lint-ignore require-await
      async (args: number, result: number | Error) => {
        if (result instanceof Error) {
          console.log("ERROR", args, result);
          return;
        }
        console.log("SUCCESS", args, result);
      },
      1_000,
    );

    const identifier = uuid();
    // await handler.schedule(identifier, 1);
    // await wait(2000);
    await handler.resolve(identifier, 1000);

    await wait(3_000);
    console.log("done");
  });
});
