import { expect } from "jsr:@std/expect";
import { beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { wait } from "../util.ts";
import { setupRedis } from "./redis.ts";
import { redisRepeat } from "./repeat.ts";

describe("redis/repeat", () => {
  beforeEach(async () => {
    await setupRedis("test");
  });

  it("repeats", async () => {
    const results: number[] = [];
    redisRepeat(
      "test",
      "test",
      async (isShutdown) => {
        for (let i = 0; i < 20; i += 1) {
          await wait(700);
          if (isShutdown()) throw Error("SHUTDOWN");
          results.push(i);
        }
        return 1000;
      },
      3000,
    );
    await wait(5000);
    expect(results).toEqual([0, 1, 2, 3]);
  });
});
