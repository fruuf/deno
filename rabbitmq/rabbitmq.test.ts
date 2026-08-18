import { expect } from "jsr:@std/expect";
import { describe, it } from "jsr:@std/testing/bdd";
import { interval, take } from "npm:rxjs";
import { cacheHandler, stringKey } from "../cache.ts";
import { createErrorMessage } from "../error.ts";
import { recordStream } from "../rxjs/helper.ts";
import { wait } from "../util.ts";
import { createRabbitStream } from "./rabbitmq.ts";

type User = {
  id: number;
  name: string;
};

const getStream = cacheHandler(
  stringKey,
  (_cleanup, name) =>
    createRabbitStream<User>("rabbitmq", name, ["id", "name"]),
);

function recordQueue(
  name: string,
  queue: string,
  partial?: Partial<User>,
) {
  return recordStream(getStream(name).readQueue(queue, partial));
}

describe("rabbitmq", () => {
  it("writes to a stream", async () => {
    await getStream("write").writeItem({ id: 1, name: "one" });
  });

  it("reads value", async () => {
    const stream = getStream("read");
    const recordId = recordStream(stream.read({ id: 1 }));
    const recordName = recordStream(stream.read({ name: "one" }));
    const recordAll = recordStream(stream.read());

    await wait(100);
    await stream.writeItem({ id: 1, name: "one" });
    await stream.writeItem({ id: 2, name: "two" });
    await wait(100);
    expect(recordId().events).toEqual([{ id: 1, name: "one" }]);
    expect(recordName().events).toEqual([{ id: 1, name: "one" }]);
    expect(recordAll().events).toEqual([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ]);

    const queue = recordQueue("read", "reads_value");
    const record = recordStream(stream.read());

    await wait(1000);

    // simulare some errors
    // process.env.RABBITMQ_RABBITMQ_PROTOCOL = "amqps";
    // await wait(2000);
    // process.env.RABBITMQ_RABBITMQ_PROTOCOL = "amqp";
    // await wait(2000);

    await stream.writeItems([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ]);
    await wait(100);

    expect(queue().events).toEqual([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ]);

    expect(record().events).toEqual([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ]);
  });

  it("reads queued value", async () => {
    const stream = getStream("queue");
    const recordId = recordQueue("queue", "queued_value", { id: 1 });
    const recordName = recordQueue("queue", "queued_value", {
      name: "one",
    });
    const recordAll = recordQueue("queue", "queued_value");

    await wait(100);
    await stream.writeItems([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ]);
    await wait(100);
    expect(recordId().events).toEqual([{ id: 1, name: "one" }]);
    expect(recordName().events).toEqual([{ id: 1, name: "one" }]);
    expect(recordAll().events).toEqual([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ]);
  });

  it("pulls values", async () => {
    const stream = getStream("pull");
    const values: User[] = [];

    stream.pullQueue("pull_values", (user) => {
      values.push(user);
    });

    await wait(100);
    await stream.writeItems([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ]);

    await wait(2000);

    expect(values).toEqual([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ]);
  });

  it("puts back failed values", async () => {
    const stream = getStream("retry");
    type Event = { id: number; retries: number };
    const events: Event[] = [];
    let oneFailed = 0;
    stream.pullQueue(
      "retries",
      async (user, retries) => {
        events.push({ id: user.id, retries });
        if (retries > 0) {
          await wait(1000);
        }
        if (user.id % 2 && retries < 2) {
          throw createErrorMessage("FAILED");
        }
        if (user.id === 1 && oneFailed < 10) {
          oneFailed += 1;
          throw createErrorMessage("ERROR");
        }
      },
      {},
      1,
    );

    interval(500).pipe(take(5)).subscribe(async (id) => {
      await stream.writeItem({ id: id, name: String(id) });
    });

    await wait(20_000);

    expect(events).toEqual([
      { id: 0, retries: 0 },
      { id: 1, retries: 0 },
      { id: 1, retries: 1 },
      { id: 2, retries: 0 },
      { id: 3, retries: 0 },
      { id: 3, retries: 1 },
      { id: 4, retries: 0 },
      { id: 1, retries: 2 },
      { id: 3, retries: 2 },
      { id: 1, retries: 3 },
      { id: 1, retries: 4 },
      { id: 1, retries: 5 },
      { id: 1, retries: 6 },
      { id: 1, retries: 7 },
      { id: 1, retries: 8 },
      { id: 1, retries: 9 },
      { id: 1, retries: 10 },
      { id: 1, retries: 10 },
      { id: 1, retries: 10 },
    ]);
  });
});
