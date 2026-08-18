import { expect } from "jsr:@std/expect";
import { describe, it } from "jsr:@std/testing/bdd";
import { ParseNumber, ParseQuery, parseSchema } from "../parse.ts";
import { recordStream } from "../rxjs/helper.ts";
import { wait } from "../util.ts";
import { createStream, getClient } from "./nats.ts";

type User = {
  id: string;
  name: string;
  age: number;
};

async function subscriptionCount(): Promise<number> {
  const nats = await getClient();
  return parseSchema(
    ParseQuery("protocol.subscriptions.subs.size", ParseNumber),
    nats,
  );
}

describe("nats", () => {
  it("creates a stream", async () => {
    const testUser = { id: "1", name: "test", age: 10 };

    const stream = createStream<User>("nats-test", "user-1");

    const users: User[] = [];

    const subscription = stream.read().subscribe((user) => {
      users.push(user);
    });

    await stream.writeItem(testUser);

    await wait(100);

    expect(users).toHaveLength(1);
    expect(users).toEqual([testUser]);

    subscription.unsubscribe();
  });

  it("creates a args stream", async () => {
    const stream = createStream<User>("nats-test", "user-2", ["name", "age"]);

    const fooAnyRecord = recordStream(stream.read({ name: "foo" }));
    const fooAnyRecord2 = recordStream(stream.read({ name: "foo" }));
    const barAnyRecord = recordStream(stream.read({ name: "bar" }));
    const any10Record = recordStream(stream.read({ age: 10 }));
    const foo10Record = recordStream(stream.read({ name: "foo", age: 10 }));
    const id1Record = recordStream(stream.read({ id: "1" }));
    const id2Record = recordStream(stream.read({ id: "2" }));

    await wait(100);

    expect(await subscriptionCount()).toEqual(5);

    await stream.writeItem({ id: "1", name: "foo", age: 10 });
    await stream.writeItem({ id: "2", name: "bar", age: 10 });
    await stream.writeItem({ id: "1", name: "foo", age: 12 });
    await stream.writeItem({ id: "2", name: "bar", age: 12 });
    await stream.writeItem({ id: "1", name: "foo", age: 14 });

    await wait(100);

    expect(fooAnyRecord().events).toHaveLength(3);
    expect(fooAnyRecord2().events).toHaveLength(3);
    expect(barAnyRecord().events).toHaveLength(2);
    expect(any10Record().events).toHaveLength(2);
    expect(foo10Record().events).toHaveLength(1);
    expect(id1Record().events).toHaveLength(3);
    expect(id2Record().events).toHaveLength(2);

    await wait(100);

    expect(await subscriptionCount()).toEqual(0);
  });

  //   describe("backendlib/nats: metrics", async () => {
  //     it("emits read and write metrics", async () => {
  //       const writeMetricsSpy = sinon.spy(metricsModule, "emitWriteMetrics");
  //       const readMetricsSpy = sinon.spy(metricsModule, "emitReadMetrics");

  //       const testUser = { id: "1", name: "test", age: 10 };
  //       const stream = createStream<User>("nats-metrics-test", "subject-1"); // this subject cannot be the same as other tests
  //       const users: User[] = [];
  //       const subscription = stream.readQueue("consumer").subscribe((user) => {
  //         users.push(user);
  //       });

  //       for (let i = 0; i < 5; i++) {
  //         await stream.writeItem(testUser);
  //         await wait(100);
  //       }
  //       subscription.unsubscribe();

  //       expect(users).toHaveLength(5);
  //       expect(writeMetricsSpy.calls.length).to.be.equal(5);
  //       expect(
  //         writeMetricsSpy.calledWith({
  //           subject: "subject-1",
  //           host: "nats-metrics-test",
  //           messageByteLength: encode(testUser).byteLength,
  //         }),
  //       ).to.be.true;

  //       expect(readMetricsSpy.calls.length).to.be.equal(5);
  //       expect(
  //         readMetricsSpy.calledWith({
  //           subject: "subject-1",
  //           host: "nats-metrics-test",
  //           queue: "consumer",
  //           messageByteLength: encode(testUser).byteLength,
  //           subPendingMessages: 0,
  //           subReceivedMessages: 5,
  //           subProcessedMessages: 5,
  //         }),
  //       ).to.be.true;
  //     });
  //   });
});
