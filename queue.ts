import { bindSpan } from "./metrics.ts";

/**
 * Creates an async queue that processes tasks with configurable parallelism.
 */
export function asyncQueue<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result>,
  parallel = 1,
) {
  let counter = 0;
  type Task = {
    resolve: (result: Result) => void;
    reject: (error: unknown) => void;
    handler: () => Promise<Result>;
  };
  const tasks: Task[] = [];
  const process = async () => {
    if (counter < parallel && tasks.length) {
      counter += 1;

      const { resolve, reject, handler } = tasks.shift()!;
      try {
        resolve(await handler());
      } catch (e) {
        reject(e);
      }
      counter -= 1;
      process();
    }
  };

  const result = (...args: Args) => {
    const nextHandler = bindSpan(() => handler(...args));
    return new Promise<Result>((resolve, reject) => {
      tasks.push({ handler: nextHandler, resolve, reject });
      process();
    });
  };
  Object.defineProperties(result, {
    size: {
      get() {
        return tasks.length;
      },
    },
    active: {
      get() {
        return counter;
      },
    },
  });
  return result;
}

/**
 * Creates a task queue for executing async functions with limited parallelism.
 */
export function asyncTaskQueue(parallel = 1) {
  const queue = asyncQueue(
    (handler: () => Promise<void>) => handler(),
    parallel,
  );

  return <Result>(handler: () => Promise<Result>) =>
    new Promise<Result>((resolve, reject) => {
      queue(async () => {
        try {
          resolve(await handler());
        } catch (e) {
          reject(e);
        }
      });
    });
}
