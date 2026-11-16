import { delay } from "jsr:@std/async";
import { expect } from "jsr:@std/expect";
import { afterEach, describe, it } from "jsr:@std/testing/bdd";
import {
  defer,
  firstValueFrom,
  lastValueFrom,
  NEVER,
  startWith,
  Subject,
  throwError,
} from "npm:rxjs";
import { filter, take, timeout } from "npm:rxjs/operators";
import { checkIsError } from "../error.ts";
import { cacheObservable } from "./cache-observable.ts";
import { activeWatchedStreams, recordStream, watchStream } from "./helper.ts";

describe("cache-observable", () => {
  afterEach(() => {
    expect(activeWatchedStreams().length).toEqual(0);
  });

  it("cacheObservable", async () => {
    type User = { userId: string; age: number };
    const subject = new Subject<User>();

    const handler = cacheObservable(
      (userId: string) =>
        watchStream(subject.pipe(filter((user) => user.userId === userId))),
      (userId) => userId,
      500,
      1,
    );

    const stream = handler("test");

    const two = lastValueFrom(stream.pipe(take(2)));

    subject.next({ userId: "test", age: 10 });

    const a = await firstValueFrom(handler("test"));

    expect(a && a.age as number).toEqual(10);

    await delay(200);
    subject.next({ userId: "test", age: 12 });

    const twoResult = await two;
    expect(twoResult && twoResult.age).toEqual(12);
    subject.next({ userId: "test", age: 14 });
    await delay(200);

    const b = await firstValueFrom(handler("test"));

    expect(b && b.age).toEqual(14);
    // wait longer then the 500ms timeout
    await delay(1000);

    try {
      await firstValueFrom(handler("test").pipe(timeout(500)));
      throw new Error();
    } catch (e) {
      checkIsError(e);
      expect(e.name).toEqual("TimeoutError");
    }

    await delay(1000);
  });

  it("error handling", async () => {
    let error: Error | null = null;

    const handler = cacheObservable(
      (userId: string) => {
        if (error !== null) {
          return throwError(error);
        }
        return NEVER.pipe(startWith({ age: 10, userId }));
      },
      (userId) => userId,
      500,
      1,
    );

    const resultA = await firstValueFrom(handler("test"));
    expect(resultA).toBeTruthy();

    error = new Error("test");

    const resultB = await firstValueFrom(handler("test"));
    expect(resultB).toEqual(resultA);

    await delay(700);

    const resultC = await firstValueFrom(handler("test")).catch((e) => e);
    expect(resultC).toEqual(error);

    error = null;

    await delay(50);
    const resultD = await firstValueFrom(handler("test"));
    expect(resultD).toEqual(resultA);
    await delay(1000);
  });

  it("completed source with publish", async () => {
    let callCount = 0;

    const handler = cacheObservable(
      (userId: string) => {
        // deno-lint-ignore require-await
        return defer(async () => {
          callCount += 1;
          return userId;
        });
      },
      (userId) => userId,
      500,
      1,
    );

    await Promise.all(
      Array(10).fill(null).map(() => firstValueFrom(handler("test"))),
    );

    await delay(100);
    await firstValueFrom(handler("test"));
    await delay(600);

    expect(callCount).toEqual(2);

    await firstValueFrom(handler("test"));
    await delay(100);
    await firstValueFrom(handler("test"));
    expect(callCount).toEqual(4);
    await delay(1000);
  });

  it("completed source without publish", async () => {
    let deferCallCount = 0;
    let handlerCallCount = 0;

    const handler = cacheObservable(
      (userId: string) => {
        handlerCallCount += 1;

        return defer(() => {
          deferCallCount += 1;
          return userId;
        });
      },
      (userId) => userId,
      500,
      0,
    );

    await firstValueFrom(handler("test"));
    await delay(100);
    await firstValueFrom(handler("test"));
    await delay(600);

    expect(handlerCallCount).toEqual(2);
    expect(deferCallCount).toEqual(2);

    await firstValueFrom(handler("test"));
    await delay(100);
    await firstValueFrom(handler("test"));
    expect(handlerCallCount).toEqual(4);
    expect(deferCallCount).toEqual(4);
    await delay(1000);
  });

  it("cacheObservable resolveKeys error", async () => {
    type User = { userId: string; age: number };
    const subject = new Subject<User>();

    const source = watchStream(subject);

    // deno-lint-ignore prefer-const
    let error: Error;

    const handler = cacheObservable(
      (userId: string) => source.pipe(filter((user) => user.userId === userId)),
      () => {
        if (error) {
          throw error;
        }
        return "";
      },
      500,
      1,
    );

    const record1 = recordStream(handler("foo"));

    subject.next({ userId: "foo", age: 10 });
    error = new Error("throw");
    subject.next({ userId: "foo", age: 10 });

    const record2 = recordStream(handler("foo"));
    const record3 = recordStream(handler("bar"));

    const result1 = record1();
    const result2 = record2();
    const result3 = record3();

    expect(result1.error).toBeFalsy();
    expect(result2.error).toBeTruthy();
    expect(result3.error).toBeTruthy();

    await delay(1000);
  });
});
