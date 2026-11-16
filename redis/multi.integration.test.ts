import { expect } from "jsr:@std/expect";
import { beforeEach, describe, it } from "jsr:@std/testing/bdd";
import {
  rdecr,
  rdecrby,
  rdel,
  rexists,
  rexpire,
  rget,
  rincr,
  rincrby,
  rincrbyfloat,
  rkeys,
  rset,
  rttl,
} from "./multi.ts";
import { setupRedis } from "./redis.ts";

describe("redis multi", () => {
  beforeEach(async () => {
    await setupRedis("test");
  });

  it("rdecr", async () => {
    const first = await rdecr("test", "rdecr");
    expect(first).toEqual(-1);
    const second = await rdecr("test", "rdecr");
    expect(second).toEqual(-2);
  });

  it("rdecrby", async () => {
    const first = await rdecrby("test", "rdecrby", 2);
    expect(first).toEqual(-2);
    const second = await rdecrby("test", "rdecrby", 2);
    expect(second).toEqual(-4);
  });

  it("rdel", async () => {
    const first = await rdel("test", "rdel");
    expect(first).toEqual(false);
    await rset("test", "rdel", "1");
    const second = await rdel("test", "rdel");
    expect(second).toEqual(true);
  });

  it("rexists", async () => {
    const first = await rexists("test", "rexists");
    expect(first).toEqual(false);
    await rset("test", "rexists", "1");
    const second = await rexists("test", "rexists");
    expect(second).toEqual(true);
  });

  it("rexpire", async () => {
    const first = await rexpire("test", "rexpire", 1000);

    expect(first).toEqual(false);
    await rset("test", "rexpire", "1");
    const second = await rexpire("test", "rexpire", 1000);

    expect(second).toEqual(true);
    expect(await rttl("test", "rexpire")).toBeGreaterThan(500);
  });

  it("rget", async () => {
    const first = await rget("test", "rget");
    expect(first).toEqual(null);
    await rset("test", "rget", "1");
    const second = await rget("test", "rget");

    expect(second).toEqual("1");
  });

  it("rincr", async () => {
    const first = await rincr("test", "rincr");

    expect(first).toEqual(1);
    const second = await rincr("test", "rincr");

    expect(second).toEqual(2);
  });

  it("rincrby", async () => {
    const first = await rincrby("test", "rincrby", 2);

    expect(first).toEqual(2);
    const second = await rincrby("test", "rincrby", 2);

    expect(second).toEqual(4);
  });

  it("rincrbyfloat", async () => {
    const first = await rincrbyfloat("test", "rincrbyfloat", 2.5);

    expect(first).toEqual(2.5);
    const second = await rincrbyfloat("test", "rincrbyfloat", 2.5);

    expect(second).toEqual(5);
  });

  it("rkeys", async () => {
    const first = await rkeys("test", "rkeys*");
    expect(first).toEqual([]);

    await Promise.all([
      rset("test", "rkeys-a", "a"),
      rset("test", "rkeys-b", "b"),
      rset("test", "rkeys-c", "c"),
    ]);
    const second = await rkeys("test", "rkeys*");
    expect(second.sort()).toEqual(["rkeys-a", "rkeys-b", "rkeys-c"]);
  });

  it("rset", async () => {
    const first = await rset("test", "rset", "test");

    expect(first).toEqual(true);
    const second = await rset("test", "rset", "test");

    expect(second).toEqual(true);
  });

  it("rttl", async () => {
    const first = await rttl("test", "rttl");

    expect(first).toEqual(-2);
    await rset("test", "rttl", "1");
    const second = await rttl("test", "rttl");

    expect(second).toEqual(-1);
    await rexpire("test", "rttl", 1000);
    const third = await rttl("test", "rttl");

    expect(third).toBeGreaterThan(500);
  });
});
