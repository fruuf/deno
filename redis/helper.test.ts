import { expect } from "jsr:@std/expect";
import { beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { spy } from "jsr:@std/testing/mock";
import { stringKey } from "../cache.ts";
import { expectAsyncError } from "../test.ts";
import { uuid, wait } from "../util.ts";
import { redisCacheHandler } from "./cache.ts";
import { redisMeasurement } from "./measurement.ts";
import { redisRateLimitHandler } from "./rate-limit.ts";
import { setupRedis } from "./redis.ts";

describe("redis helper", () => {
  beforeEach(async () => {
    await setupRedis("test");
    await wait(1000);
  });

  it("rate limit", async () => {
    const handler = spy((name: string) => ({ name }));

    const rateLimit = redisRateLimitHandler(
      "test",
      "test",
      1000,
      2,
      stringKey,
      handler,
    );

    await rateLimit("test");
    await wait(250);
    await rateLimit("test");
    // limits violated, error
    await expectAsyncError(() => rateLimit("test"), "rateLimit");
    expect(handler.calls.length).toEqual(2);

    // check that limits are still violated within 1000ms window
    await wait(250);
    await expectAsyncError(() => rateLimit("test"), "rateLimit");
    expect(handler.calls.length).toEqual(2);

    // deos not reset expire
    await wait(700);
    await rateLimit("test");
  });

  it("measurement values", async () => {
    const measureShort = redisMeasurement("test", "small", 1000 * 5);
    const measureLong = redisMeasurement("test", "long", 1000 * 10);
    for (let i = 0; i < 10; i += 1) {
      await Promise.all([
        measureShort.write("a", 10),
        measureShort.write("b", 20),
        measureLong.write("a", 10),
        measureLong.write("b", 20),
      ]);
      await wait(300);
    }

    expect(await measureShort.read("a")).toEqual(100);
    expect(await measureShort.read("b")).toEqual(200);
    expect(await measureLong.read("a")).toEqual(100);
    expect(await measureLong.read("b")).toEqual(200);

    await wait(4000);
    expect(await measureShort.read("a")).toBeGreaterThan(0);
    expect(await measureShort.read("b")).toBeGreaterThan(0);
    expect(await measureShort.read("a")).toBeLessThan(100);
    expect(await measureShort.read("b")).toBeLessThan(200);
    expect(await measureLong.read("a")).toEqual(100);
    expect(await measureLong.read("b")).toEqual(200);

    const maxValues = await measureLong.max(2);
    expect(maxValues).toEqual([
      { key: "b", value: 200 },
      { key: "a", value: 100 },
    ]);

    const minValues = await measureLong.min(2);
    expect(minValues).toEqual([
      { key: "a", value: 100 },
      { key: "b", value: 200 },
    ]);

    const expireMeasurement = redisMeasurement("test", "expire", 5000, 1);
    await expireMeasurement.write("a", 10);
    expect(await expireMeasurement.read("a")).toEqual(10);
    await wait(5000);
    const value = await expireMeasurement.read("a");
    expect(value).toBeLessThan(10);
    await wait(1000);
    const nextValue = await expireMeasurement.read("a");
    expect(nextValue).toBeGreaterThan(0);
    expect(nextValue).toBeLessThan(value);
  });

  it("redisCacheHandler", async () => {
    const cachedGetUser = redisCacheHandler(
      "test",
      "redisCacheHandler",
      500,
      stringKey,
      (name: string) => ({
        id: uuid(),
        name,
        createdAt: Date.now(),
      }),
    );

    const [userA, userB] = await Promise.all([
      cachedGetUser("a"),
      cachedGetUser("b"),
    ]);

    expect(userA.name).toEqual("a");
    expect(userB.name).toEqual("b");

    expect(await cachedGetUser("a")).toEqual(userA);
    expect(await cachedGetUser("b")).toEqual(userB);

    await wait(1000);

    expect(await cachedGetUser("a")).not.toEqual(userA);
    expect(await cachedGetUser("b")).not.toEqual(userB);

    const [userC, nextUserC] = await Promise.all([
      cachedGetUser("c"),
      cachedGetUser("c"),
    ]);

    expect(nextUserC).toEqual(userC);
  });
});
