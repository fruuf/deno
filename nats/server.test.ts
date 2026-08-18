import { expect } from "jsr:@std/expect";
import { before, describe, it } from "jsr:@std/testing/bdd";
import { spy } from "jsr:@std/testing/mock";
import { firstValueFrom } from "npm:rxjs";
import { createSingleBatch } from "../batch.ts";
import { stringKey } from "../cache.ts";
import {
  checkIsError,
  checkIsValue,
  createErrorMessage,
  isError,
  isSafeError,
} from "../error.ts";
import { activeSpan, withSpan } from "../metrics.ts";
import { createStream } from "../nats.ts";
import { cacheObservableWithSpread } from "../rxjs/cache-observable-with-spread.ts";
import { isValue, uuid, wait } from "../util.ts";
import { createApiMethod } from "./client.ts";
import { implementServerApi } from "./server.ts";

type TestError = "none" | "safe" | "unknown";

// deno-lint-ignore require-await
async function testError(error: TestError) {
  if (error === "safe") {
    throw createErrorMessage("safe");
  }

  if (error === "unknown") {
    throw new Error("unsafe");
  }

  return null;
}

const testErrorMethod = createApiMethod<typeof testError>(
  "server-test",
  "test-error",
);

type User = {
  id: string;
  name: string;
  age: number;
};

const userMap = new Map<string, User>();

const userStream = createStream<User>("test-server", "user");

const createUser = spy(async (name: string, age: number) => {
  const id = uuid();
  const user = { id, name, age };
  userMap.set(id, user);
  await userStream.writeItem(user);
  return user;
});

const createUserMethod = createApiMethod<typeof createUser>(
  "server-test",
  "create-user",
);

// deno-lint-ignore require-await
const getBatchedUsers = spy(async (userIds: string[]) => {
  return userIds
    .map((userId) => userMap.get(userId))
    .filter(isValue);
});

const getUserMethod = createApiMethod<typeof getBatchedUsers>(
  "server-test",
  "get-batched-users",
);

const getUserBatched = createSingleBatch(getUserMethod, stringKey, ["id"]);

const updateUser = spy(async (userId: string, age: number) => {
  const user = userMap.get(userId);
  if (!user) {
    throw createErrorMessage("userNotFound");
  }
  const nextUser = { ...user, age };
  userMap.set(userId, nextUser);
  await userStream.writeItem(nextUser);
  return nextUser;
});

const updateUserMethod = createApiMethod<typeof updateUser>(
  "server-test",
  "update-user",
);

const slowHandler = async () => {
  await wait(15000);
  return null;
};

const slowMethod = createApiMethod<typeof slowHandler>(
  "server-test",
  "slow-method",
  20000,
);

// deno-lint-ignore require-await
const fastHandler = async (name: string) => {
  return name;
};

const fastMethod = createApiMethod<typeof fastHandler>(
  "server-test",
  "fast-method",
);

const spanHandler = async () => {
  await wait(0);
  const span = activeSpan();
  if (!span) {
    return null;
  }
  const { traceId, spanId } = span.spanContext();
  return { traceId, spanId };
};

const spanMethod = createApiMethod<typeof spanHandler>(
  "server-test",
  "span-method",
);

const getShortUserObservable = cacheObservableWithSpread(
  async (userId: string) => {
    const user = await getUserBatched(userId);
    console.log("user", userId, user);
    checkIsValue(user, "user");
    return user;
  },
  userStream.readQueue("server-test"),
  (userId) => userId,
  ({ id }) => id,
  1000,
);

const getLongUserObservable = cacheObservableWithSpread(
  async (userId: string) => {
    const user = await getUserBatched(userId);
    checkIsValue(user, "user");
    return user;
  },
  userStream.readQueue("server-test"),
  (userId) => userId,
  ({ id }) => id,
  10000,
);

describe("server", () => {
  before(async () => {
    await implementServerApi(testErrorMethod, testError);
    await implementServerApi(createUserMethod, createUser);
    await implementServerApi(getUserMethod, getBatchedUsers);
    await implementServerApi(updateUserMethod, updateUser);
    await implementServerApi(slowMethod, slowHandler);
    await implementServerApi(fastMethod, fastHandler);
    await implementServerApi(spanMethod, spanHandler);
  });

  it("handles errors", async () => {
    async function catchError(error: TestError): Promise<null | Error> {
      try {
        return await testErrorMethod(error);
      } catch (e) {
        checkIsError(e);
        return e;
      }
    }

    const e1 = await catchError("none");
    expect(e1).toEqual(null);

    const e2 = await catchError("safe");
    if (!isError(e2)) {
      throw new Error("e2 must be Error");
    }
    if (!isSafeError(e2)) {
      throw new Error("e2 must be safe error");
    }
    expect(e2.message).toEqual("safe");
    expect(e2.errorType).toEqual("safe");
    // expect(e2.data).toEqual({ foo: "bar" });

    const e3 = await catchError("unknown");
    if (!isError(e3)) {
      throw new Error("e3 must be Error");
    }
    if (!isSafeError(e3)) {
      throw new Error("e3 must be safe error");
    }
    expect(e3.message).toEqual("unknown");
    expect(e3.errorType).toEqual("unknown");
  });

  let firstUser: User | undefined;
  let secondUser: User | undefined;

  it("creates a user", async () => {
    firstUser = await createUserMethod("test1", 10);
    expect(firstUser.name).toEqual("test1");
    expect(firstUser.age).toEqual(10);
    expect(createUser.calls.length).toEqual(1);

    secondUser = await createUserMethod("test2", 10);
  });

  it("gets batched users", async () => {
    if (!firstUser || !secondUser) {
      throw new Error("no first user");
    }

    const [userA, userB] = await Promise.all([
      getUserBatched(firstUser.id),
      getUserBatched(secondUser.id),
    ]);
    expect(userA).toEqual(firstUser);
    expect(userB).toEqual(secondUser);

    expect(getBatchedUsers.calls.length).toEqual(1);
  });

  it("gets user observables", async () => {
    const batchedUserCalls = getBatchedUsers.calls.length;
    if (!firstUser || !secondUser) {
      throw new Error("no first user");
    }

    const shortStream = getShortUserObservable(firstUser.id);

    const longStream = getLongUserObservable(firstUser.id);

    await wait(500);
    expect(getBatchedUsers.calls.length).toEqual(batchedUserCalls);

    const userA = await firstValueFrom(shortStream);
    await wait(100);
    const userB = await firstValueFrom(longStream);

    expect(userA).toEqual(firstUser);
    expect(userB).toEqual(firstUser);

    expect(getBatchedUsers.calls.length).toEqual(batchedUserCalls + 2);

    await wait(500);
    const userC = await firstValueFrom(shortStream);
    const userD = await firstValueFrom(longStream);

    expect(getBatchedUsers.calls.length).toEqual(batchedUserCalls + 2);
    expect(userC).toEqual(firstUser);
    expect(userD).toEqual(firstUser);

    await wait(2000);
    // short stream has closed after 1s, so it will run getUserMethod again
    const userE = await firstValueFrom(shortStream);
    const userF = await firstValueFrom(longStream);

    expect(getBatchedUsers.calls.length).toEqual(batchedUserCalls + 3);
    expect(userE).toEqual(firstUser);
    expect(userF).toEqual(firstUser);

    await updateUserMethod(firstUser.id, 12);

    await wait(500);

    const userG = await firstValueFrom(shortStream);
    const userH = await firstValueFrom(longStream);

    expect(getBatchedUsers.calls.length).toEqual(batchedUserCalls + 3);
    expect(userG?.id).toEqual(firstUser.id);
    expect(userG?.age).toEqual(12);
    expect(userH?.id).toEqual(firstUser.id);
    expect(userH?.age).toEqual(12);
  });

  it("slow method", async () => {
    await slowMethod();
  });

  it("fast method", async () => {
    const results: Promise<string[]>[] = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(
        Promise.all(
          Array(1000).fill(null).map((n) => fastMethod(`test_${n}`)),
        ),
      );
      await wait(20);
    }
    await Promise.all(results);
  });

  it("preservs span", async () => {
    await withSpan("test", async () => {
      const span = activeSpan();
      checkIsValue(span, "span");
      const current = span.spanContext();
      const next = await spanMethod();
      checkIsValue(next, "span");
      expect(current.traceId).toEqual(next.traceId);
    }, false)();
  });
});
