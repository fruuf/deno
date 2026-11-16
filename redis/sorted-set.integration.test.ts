import { expect } from "jsr:@std/expect";
import { before, describe, it } from "jsr:@std/testing/bdd";
import { setupRedis } from "./redis.ts";
import {
  rzadd,
  rzcard,
  rzcount,
  rzincrby,
  rzpopmax,
  rzpopmin,
  rzrange,
  rzrangebyscore,
  rzrank,
  rzrem,
  rzremrangebyscore,
  rzrevrange,
  rzscore,
} from "./sorted-set.ts";

describe("sorted set", () => {
  before(async () => {
    await setupRedis("test");
  });

  it("rzadd", async () => {
    const first = await rzadd("test", "rzadd", [
      [1, "first"],
      [2, "second"],
    ]);

    expect(first).toEqual(2);
    expect(await rzrange("test", "rzadd", 0, 2)).toEqual([
      ["first", 1],
      ["second", 2],
    ]);

    const second = await rzadd("test", "rzadd", [
      [2, "first"],
      [1, "second"],
    ]);

    expect(second).toEqual(0);

    expect(await rzrange("test", "rzadd", 0, 2)).toEqual([
      ["second", 1],
      ["first", 2],
    ]);

    const third = await rzadd(
      "test",
      "rzadd",
      [
        [0, "first"],
        [0, "second"],
        [3, "third"],
      ],
      "NX",
    );

    expect(third).toEqual(1);
    expect(await rzrange("test", "rzadd", 0, 2)).toEqual([
      ["second", 1],
      ["first", 2],
      ["third", 3],
    ]);
  });

  it("rzadd", async () => {
    const first = await rzcard("test", "zcard");

    expect(first).toEqual(0);
    await rzadd("test", "zcard", [
      [1, "first"],
      [2, "second"],
    ]);

    const second = await rzcard("test", "zcard");

    expect(second).toEqual(2);
  });

  it("rzincrby", async () => {
    const first = await rzincrby("test", "rzincrby", "first", 1.5);

    expect(first).toEqual(1.5);

    const second = await rzincrby("test", "rzincrby", "first", 1.5);

    expect(second).toEqual(3);

    await rzincrby("test", "rzincrby", "next", 10);
    await rzincrby("test", "rzincrby", "next", 10);
    await rzincrby("test", "rzincrby", "next", 10);

    const score = await rzscore("test", "rzincrby", "next");
    expect(score).toEqual(30);
  });

  it("rzpopmax", async () => {
    const first = await rzpopmax("test", "rzpopmax", 1);

    expect(first).toEqual([]);

    await rzadd("test", "rzpopmax", [
      [1, "first"],
      [2, "second"],
      [3, "third"],
    ]);

    const second = await rzpopmax("test", "rzpopmax", 1);

    expect(second).toEqual([["third", 3]]);

    const third = await rzpopmax("test", "rzpopmax", 2);

    expect(third).toEqual([
      ["second", 2],
      ["first", 1],
    ]);
  });

  it("rzpopmin", async () => {
    const first = await rzpopmin("test", "rzpopmin", 1);

    expect(first).toEqual([]);

    await rzadd("test", "rzpopmin", [
      [1, "first"],
      [2, "second"],
      [3, "third"],
    ]);

    const second = await rzpopmin("test", "rzpopmin", 1);

    expect(second).toEqual([["first", 1]]);

    const third = await rzpopmin("test", "rzpopmin", 2);

    expect(third).toEqual([
      ["second", 2],
      ["third", 3],
    ]);
  });

  it("rzrange", async () => {
    const first = await rzrange("test", "rzrange", 0, 5);

    expect(first).toEqual([]);

    await rzadd("test", "rzrange", [
      [1, "first"],
      [2, "second"],
      [3, "third"],
      [4, "fourth"],
      [5, "fifth"],
    ]);

    const second = await rzrange("test", "rzrange", 0, 1);

    expect(second).toEqual([
      ["first", 1],
      ["second", 2],
    ]);

    const third = await rzrange("test", "rzrange", 2, 3);

    expect(third).toEqual([
      ["third", 3],
      ["fourth", 4],
    ]);
  });

  it("rzcount", async () => {
    const first = await rzcount("test", "rzcount", 0, 5);

    expect(first).toEqual(0);

    await rzadd("test", "rzcount", [
      [1, "first"],
      [2, "second"],
      [3, "third"],
      [4, "fourth"],
      [5, "fifth"],
    ]);

    const second = await rzcount("test", "rzcount", 0, 1);

    expect(second).toEqual(1);

    const third = await rzcount("test", "rzcount", 2, 5);

    expect(third).toEqual(4);
  });

  it("rzrank", async () => {
    const first = await rzrank("test", "rzrank", "third");
    expect(first).toEqual(null);

    await rzadd("test", "rzrank", [[3, "third"]]);

    const second = await rzrank("test", "rzrank", "third");
    expect(second).toEqual(0);

    await rzadd("test", "rzrank", [
      [1, "first"],
      [2, "second"],
      [4, "fourth"],
      [5, "fifth"],
    ]);

    const third = await rzrank("test", "rzrank", "third");
    expect(third).toEqual(2);
  });

  it("rzrangebyscore", async () => {
    const first = await rzrangebyscore("test", "rzrangebyscore", 0, 5);

    expect(first).toEqual([]);

    await rzadd("test", "rzrangebyscore", [
      [1, "first"],
      [2, "second"],
      [3, "third"],
      [4, "fourth"],
      [5, "fifth"],
    ]);

    const second = await rzrangebyscore("test", "rzrangebyscore", 0, 2);

    expect(second).toEqual([
      ["first", 1],
      ["second", 2],
    ]);

    const third = await rzrangebyscore("test", "rzrangebyscore", 3, 4);

    expect(third).toEqual([
      ["third", 3],
      ["fourth", 4],
    ]);
  });

  it("rzrem", async () => {
    await rzadd("test", "rzrem", [
      [1, "first"],
      [2, "second"],
    ]);
    const first = await rzrem("test", "rzrem", ["first", "second"]);
    expect(first).toEqual(2);
    const second = await rzrem("test", "rzrem", ["first", "second"]);
    expect(second).toEqual(0);
  });

  it("rzremrangebyscore", async () => {
    const first = await rzremrangebyscore("test", "rzremrangebyscore", 0, 5);

    expect(first).toEqual(0);

    await rzadd("test", "rzremrangebyscore", [
      [1, "first"],
      [2, "second"],
      [3, "third"],
      [4, "fourth"],
      [5, "fifth"],
    ]);

    const second = await rzremrangebyscore("test", "rzremrangebyscore", 0, 2);

    expect(second).toEqual(2);

    const third = await rzremrangebyscore("test", "rzremrangebyscore", 3, 4);

    expect(third).toEqual(2);
  });

  it("rzrevrange", async () => {
    const first = await rzrevrange("test", "rzrevrange", 0, 5);

    expect(first).toEqual([]);

    await rzadd("test", "rzrevrange", [
      [1, "first"],
      [2, "second"],
      [3, "third"],
      [4, "fourth"],
      [5, "fifth"],
    ]);

    const second = await rzrevrange("test", "rzrevrange", 0, 1);

    expect(second).toEqual([
      ["fifth", 5],
      ["fourth", 4],
    ]);

    const third = await rzrevrange("test", "rzrevrange", 2, 3);

    expect(third).toEqual([
      ["third", 3],
      ["second", 2],
    ]);
  });

  it("rzscore", async () => {
    const first = await rzscore("test", "rzscore", "first");
    expect(first).toEqual(null);

    await rzadd("test", "rzscore", [[1, "first"]]);

    const second = await rzscore("test", "rzscore", "first");

    expect(second).toEqual(1);

    await rzadd("test", "rzscore", [[0, "first"]]);

    const third = await rzscore("test", "rzscore", "first");

    expect(third).toEqual(0);
  });
});
