import { delay } from "jsr:@std/async";
import { Observable } from "npm:rxjs";
import { Key, resolveKey } from "../cache.ts";

type BatchProcessMeta = {
  concurrentCount: number;
  queueSize: number;
  isComplete: boolean;
};

/**
 * Creates a concurrency control function that limits processing based on queue size to target ratio.
 */
export const queueSizeTarget =
  (target: number) => ({ concurrentCount, queueSize }: BatchProcessMeta) =>
    concurrentCount === 0 || queueSize / target > concurrentCount;

/**
 * Groups stream items by key and processes them concurrently with customizable batch handling.
 */
export function batchProcessGroup<Source, Group, Target>(
  getKeys: Key<[Source]>,
  groupHandler: (event: Source, group?: Group) => Group,
  processHandler: (
    group: Group,
    meta: BatchProcessMeta,
  ) => Promise<Target> | Target,
  concurrency: number | ((meta: BatchProcessMeta) => boolean) = 1,
  timeout = 20,
) {
  const resolvedKey = resolveKey(getKeys);
  const wrappedProcessHandler = processHandler;
  return (stream: Observable<Source>) =>
    new Observable<Target>((observer) => {
      let groupMap = new Map<string, Group>();
      let groupQueue: string[] = [];
      let processingSet = new Set<string>();
      let isComplete = false;
      let isUnsubscribed = false;
      let error: Error | null = null;
      let concurrentCount = 0;

      const shouldProcessNext = (typeof concurrency === "number")
        ? () => concurrentCount < concurrency
        : concurrency;

      async function next() {
        if (isUnsubscribed) return;
        if (error && groupQueue.length === 0 && concurrentCount === 0) {
          observer.error(error);
          return;
        }

        if (isComplete && groupQueue.length === 0 && concurrentCount === 0) {
          observer.complete();
        }

        if (
          groupQueue.length === 0 ||
          !shouldProcessNext({
            concurrentCount,
            queueSize: groupMap.size,
            isComplete,
          })
        ) {
          return;
        }

        const key = groupQueue.shift();
        if (key === undefined) return;

        if (processingSet.has(key)) {
          groupQueue.push(key);
          return;
        }
        processingSet.add(key);
        concurrentCount += 1;

        await delay(0);

        const group = groupMap.get(key)!;
        groupMap.delete(key);

        try {
          const target = await wrappedProcessHandler(group, {
            concurrentCount,
            queueSize: groupMap.size,
            isComplete,
          });
          observer.next(target);
        } catch (e) {
          observer.error(e);
        }
        await delay(isComplete ? 0 : timeout);
        processingSet.delete(key);
        concurrentCount -= 1;

        next();
      }
      const subscription = stream.subscribe({
        next(event) {
          try {
            const key = resolvedKey(event);
            if (!groupMap.has(key)) groupQueue.push(key);
            groupMap.set(key, groupHandler(event, groupMap.get(key)));
            next();
          } catch (nextError) {
            observer.error(nextError);
          }
        },
        complete() {
          isComplete = true;
          next();
        },
        error(nextError: Error) {
          error = nextError;
          next();
        },
      });

      return () => {
        isUnsubscribed = true;
        groupMap = new Map();
        groupQueue = [];
        processingSet = new Set();
        error = null;
        subscription.unsubscribe();
      };
    });
}

/**
 * Batches stream items by key and processes arrays of items with controlled concurrency.
 */
export function batchProcess<Source, Target>(
  getKeys: Key<[Source]>,
  handler: (
    events: Source[],
    meta: BatchProcessMeta,
  ) => Promise<Target> | Target,
  concurrency: number | ((meta: BatchProcessMeta) => boolean) = 1,
  timeout = 20,
): (source: Observable<Source>) => Observable<Target> {
  return batchProcessGroup(
    getKeys,
    (event, events?: Source[]) => {
      if (!events) return [event];
      events.push(event);
      return events;
    },
    handler,
    concurrency,
    timeout,
  );
}
