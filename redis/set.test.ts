import { expect } from "jsr:@std/expect";
import { before, describe, it } from "jsr:@std/testing/bdd";
import { setupRedis } from "./redis.ts";
import { rsadd, rscard, rsismember, rsmembers, rsrem } from "./set.ts";

describe("sorted set", () => {
  before(async () => {
    await setupRedis("test");
  });

  it("rsadd", async () => {
    const first = await rsadd("test", "rsadd", ["first", "second"]);

    expect(first).toEqual(2);
    const second = await rsadd("test", "rsadd", ["first", "second"]);

    expect(second).toEqual(0);
  });

  it("rsmembers", async () => {
    const first = await rsmembers("test", "rsmembers");

    expect(first).toEqual([]);
    await rsadd("test", "rsmembers", ["first", "second"]);
    const second = await rsmembers("test", "rsmembers");

    expect(second.sort()).toEqual(["first", "second"]);
  });

  it("rsrem", async () => {
    await rsadd("test", "rsrem", ["first", "second"]);
    const first = await rsrem("test", "rsrem", ["first", "second"]);
    expect(first).toEqual(2);
    const second = await rsrem("test", "rsrem", ["first", "second"]);
    expect(second).toEqual(0);
  });

  it("rsismember", async () => {
    await rsadd("test", "rsismember", ["first", "second"]);
    const second = await rsismember("test", "rsismember", "second");
    expect(second).toEqual(true);
    const third = await rsismember("test", "rsismember", "third");
    expect(third).toEqual(false);
  });

  it("rscard", async () => {
    await rsadd("test", "rscard", ["first", "second"]);
    const first = await rscard("test", "rscard");
    expect(first).toEqual(2);
    await rsadd("test", "rscard", ["third", "second"]);
    const second = await rscard("test", "rscard");
    expect(second).toEqual(3);
    await rsrem("test", "rscard", ["third", "second", "first"]);
    const third = await rscard("test", "rscard");
    expect(third).toEqual(0);
  });
});
