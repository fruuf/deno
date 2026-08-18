import { expect } from "jsr:@std/expect";
import { beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { wait } from "../util.ts";
import { redisQueue } from "./queue.ts";
import { setupRedis } from "./redis.ts";

describe("redisQueue", () => {
  beforeEach(async () => {
    await setupRedis("test");
  });

  it("processes items in order of being added", async () => {
    const items: string[] = [];
    const queue = redisQueue(
      "test",
      "queue",
      async (item) => {
        await wait(500);
        items.push(item);
      },
      5,
    );

    queue("1");
    await wait(100);

    expect(items).toEqual([]);

    queue("2");
    await wait(100);

    queue("3");
    await wait(2000);

    expect(items).toEqual(["1", "2", "3"]);
  });
});
