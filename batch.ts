import { delay } from "jsr:@std/async";
import { chunk } from "jsr:@std/collections";
import { cacheHandler, type Key, resolveKey } from "./cache.ts";

/**
 * Creates a batching collector that groups requests by arguments.
 */
export function createCollector<BatchArg, GroupArgs extends unknown[], Result>(
  handler: (
    getValues: () => BatchArg[],
    ...args: GroupArgs
  ) => Promise<Result[]>,
  getBatchArgKey: Key<[BatchArg]>,
  getGroupArgsKey: Key<GroupArgs>,
  getResultKey: Key<[Result]>,
) {
  type CollectGroup = {
    batchArg: BatchArg;
    resolve: (results: Result[]) => void;
    reject: (error: unknown) => void;
  };
  const resolvedBatchKey = resolveKey(getBatchArgKey);
  const resolvedGroupKey = resolveKey(getGroupArgsKey);
  const resolvedResultKey = resolveKey(getResultKey);

  const getGroupCollector = cacheHandler(
    resolvedGroupKey,
    (cleanupGroup, ...groupArgs) => {
      const collection: CollectGroup[] = [];

      queueMicrotask(async () => {
        try {
          const results = await handler(
            () => {
              cleanupGroup();
              return collection.map(({ batchArg }) => batchArg);
            },
            ...groupArgs,
          );
          cleanupGroup();
          const groups = Object.groupBy(results, resolvedResultKey);
          collection.forEach(({ resolve, batchArg }) =>
            resolve(groups[resolvedBatchKey(batchArg)] || [])
          );
        } catch (e) {
          cleanupGroup();
          collection.forEach(({ reject }) => reject(e));
        }
      });
      return cacheHandler(
        resolvedBatchKey,
        (_cleanupBatch, batchArg) =>
          new Promise<Result[]>((resolve, reject) => {
            collection.push({ batchArg, resolve, reject });
          }),
      );
    },
  );

  return cacheHandler(
    (value: BatchArg, ...groupArgs: GroupArgs) =>
      `${resolvedBatchKey(value)}/${resolvedGroupKey(...groupArgs)}`,
    async (cleanup, value: BatchArg, ...groupArgs: GroupArgs) => {
      try {
        const result = await getGroupCollector(...groupArgs)(value);
        cleanup();
        return result;
      } catch (e) {
        cleanup();
        throw e;
      }
    },
  );
}

type Options = {
  maxBatchSize?: number;
  collectionDuration?: number;
};
/*
  the idea behind batching methods is due to the nature of gql we end up getting
  a lot of 'related' lookups, so loading a list of 20 messages triggers 20 user
  lookups (for each of those messages). since we dont want to send of 20
  individual requests we group (arg) and collect them (batch-arg) and send them
  off together.

  lets say you want to look up those 20 users, the batch method will collect
  all of the user Ids that are triggered by looping over the messages by waiting
  for the next setImmediate call and then send them off together as one request.

  in the case of a user the GroupArgs would be null, since there is nothing to group the
  requests by. if you think about a fixture translation lookup (fixtureId / language)
  you'd use language as n argument to group the requests. so you'd send of
  ('sr:match:1', 'en'), ('sr:match:2', 'en'), ('sr:match:3', 'en') together and
  ('sr:match:1', 'de'), ('sr:match:2', 'de'), ('sr:match:3', 'de') together
*/

// this is the exact same function as createSingleGroupBatchApiMethod except that it returns
// a list of results. think of rahter looking up the statistics for a particular user
// (multiple rows, many games / currencies) rather then looking up the user (one item)
/**
 * Creates a batched handler that returns multiple results per input.
 */
export function createMultiGroupBatch<
  BatchArg,
  GroupArgs extends unknown[],
  Result,
>(
  handler: (values: BatchArg[], ...args: GroupArgs) => Promise<Result[]>,
  getBatchArgKey: Key<[BatchArg]>,
  getGroupArgsKey: Key<GroupArgs>,
  getResultKey: Key<[Result]>,
  options?: Options,
) {
  const maxBatchSize = options?.maxBatchSize || 50;
  const collectionDuration = options?.collectionDuration || 0;
  return createCollector(
    async (getValues, ...groupArgs) => {
      if (collectionDuration > 0) {
        await delay(collectionDuration);
      }
      const values = getValues();
      return (await Promise.all(
        chunk(values, maxBatchSize).map((chunk) =>
          handler(chunk, ...groupArgs)
        ),
      )).flat();
    },
    getBatchArgKey,
    getGroupArgsKey,
    getResultKey,
  );
}

/**
 * Creates a batched handler that returns a single result per input.
 */
export function createSingleGroupBatch<
  BatchArg,
  GroupArgs extends unknown[],
  Result,
>(
  handler: (values: BatchArg[], ...args: GroupArgs) => Promise<Result[]>,
  getBatchArgKey: Key<[BatchArg]>,
  getGroupArgsKey: Key<GroupArgs>,
  getResultKey: Key<[Result]>,
  options?: Options,
) {
  const listCollector = createMultiGroupBatch(
    handler,
    getBatchArgKey,
    getGroupArgsKey,
    getResultKey,
    options,
  );

  return async (value: BatchArg, ...args: GroupArgs) => {
    const [result = null] = await listCollector(value, ...args);
    return result;
  };
}

/**
 * Creates a simple batched handler returning multiple results.
 */
export function createMultiBatch<BatchArg, Result>(
  handler: (values: BatchArg[]) => Promise<Result[]>,
  getBatchArgKey: Key<[BatchArg]>,
  getResultKey: Key<[Result]>,
  options?: Options,
) {
  const listCollector = createMultiGroupBatch(
    handler,
    getBatchArgKey,
    null,
    getResultKey,
    options,
  );

  return (value: BatchArg) => listCollector(value);
}

/**
 * Creates a simple batched handler returning single results.
 */
export function createSingleBatch<BatchArg, Result>(
  handler: (values: BatchArg[]) => Promise<Result[]>,
  getBatchArgKey: Key<[BatchArg]>,
  getResultKey: Key<[Result]>,
  options?: Options,
) {
  const listCollector = createMultiBatch(
    handler,
    getBatchArgKey,
    getResultKey,
    options,
  );

  return async (value: BatchArg) => {
    const [result = null] = await listCollector(value);
    return result;
  };
}
