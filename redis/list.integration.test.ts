import { expect } from "jsr:@std/expect";
import { before, describe, it } from "jsr:@std/testing/bdd";
import { rllen, rlpop, rlpush, rlrange, rrpop, rrpush } from "./list.ts";
import { setupRedis } from "./redis.ts";

describe("list", () => {
  before(async () => {
    await setupRedis("test");
  });

  it("rlpush", async () => {
    expect(await rlpush("test", "rlpush", ["a"])).toEqual(1);
    expect(await rlpush("test", "rlpush", ["b", "c", "d"])).toEqual(4);
    expect(await rlrange("test", "rlpush", 0, -1)).toEqual([
      "d",
      "c",
      "b",
      "a",
    ]);
  });

  it("rrpush", async () => {
    expect(await rrpush("test", "rrpush", ["a"])).toEqual(1);
    expect(await rrpush("test", "rrpush", ["b", "c", "d"])).toEqual(4);
    expect(await rlrange("test", "rrpush", 0, -1)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("rllen", async () => {
    expect(await rllen("test", "rllen")).toEqual(0);
    await rlpush("test", "rllen", ["a"]);
    expect(await rllen("test", "rllen")).toEqual(1);
  });

  it("rlpop", async () => {
    expect(await rlpop("test", "rlpop")).toEqual([]);
    await rrpush("test", "rlpop", ["a", "b", "c", "d"]);
    expect(await rlpop("test", "rlpop")).toEqual(["a"]);
    expect(await rlpop("test", "rlpop", 2)).toEqual(["b", "c"]);
    expect(await rlrange("test", "rlpop", 0, -1)).toEqual(["d"]);
  });

  it("rrpop", async () => {
    expect(await rrpop("test", "rrpop")).toEqual([]);
    await rrpush("test", "rrpop", ["a", "b", "c", "d"]);
    expect(await rrpop("test", "rrpop")).toEqual(["d"]);
    expect(await rrpop("test", "rrpop", 2)).toEqual(["c", "b"]);
    expect(await rlrange("test", "rrpop", 0, -1)).toEqual(["a"]);
  });

  it("rlrange", async () => {
    expect(await rlrange("test", "rlrange", 0, -1)).toEqual([]);
    await rrpush("test", "rlrange", ["a", "b", "c", "d"]);
    expect(await rlrange("test", "rlrange", 1, 2)).toEqual(["b", "c"]);
    expect(await rlrange("test", "rlrange", 3, 4)).toEqual(["d"]);
    expect(await rlrange("test", "rlrange", 5, 6)).toEqual([]);
  });
});
