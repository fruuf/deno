import { beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { wait } from "../util.ts";
import { setupRedis } from "./redis.ts";
import { redisScheduler } from "./scheduler.ts";

describe("scheduler", () => {
  beforeEach(async () => {
    await setupRedis("test");
  });

  it("schedules", async () => {
    let max = 0;
    let log = 0;
    const scheduler = redisScheduler(
      "test",
      "test",
      (duration: number, date: number) => {
        const delay = Date.now() - date - duration;
        const record = delay - max;
        if (record <= 0) return;
        max = delay;
        if (delay - log < 50) return;
        log = delay;
      },
    );

    redisScheduler("test", "test1", async () => {});
    redisScheduler("test", "test2", async () => {});
    redisScheduler("test", "test3", async () => {});
    redisScheduler("test", "test4", async () => {});

    await Promise.all(
      new Array(1000).fill(null).map(async () => {
        const duration = Math.floor(Math.random() * 5000);
        await scheduler.schedule(duration, duration, Date.now());
      }),
    );

    await wait(6_000);
  });
});
