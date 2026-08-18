import { delay } from "jsr:@std/async";
import { expect } from "jsr:@std/expect";
import { describe, it } from "jsr:@std/testing/bdd";
import { Subject } from "npm:rxjs";
import { batchProcess } from "./batch-process.ts";
import { recordStream, watchStream } from "./helper.ts";

type Payload = {
  type: string;
  value: number;
};

describe("batch-process", () => {
  it("processes batches", async () => {
    const subject = new Subject<Payload>();
    const source = watchStream(subject);
    const record = recordStream(
      source.pipe(
        batchProcess(
          ({ type }) => type,
          async (payloads) => {
            const [{ type }] = payloads;
            // this is some expensive operation that we can group
            await delay(1000);
            const aggregated: Payload = {
              type,
              value: payloads.reduce((acc, { value }) => acc + value, 0),
            };
            return aggregated;
          },
          // does not spawn multiple
          5,
          0,
        ),
      ),
    );

    subject.next({ type: "a", value: 1 });
    subject.next({ type: "b", value: 2 });
    subject.next({ type: "a", value: 3 });
    subject.next({ type: "b", value: 4 });
    subject.next({ type: "a", value: 5 });
    subject.next({ type: "b", value: 6 });

    await delay(500);

    subject.next({ type: "a", value: 1 });
    subject.next({ type: "b", value: 2 });
    subject.next({ type: "a", value: 3 });
    subject.next({ type: "b", value: 4 });
    subject.next({ type: "a", value: 5 });
    subject.next({ type: "b", value: 6 });

    subject.complete();

    await delay(2000);

    const { events, complete, error } = record();

    expect(error).toEqual(null);
    expect(complete).toEqual(true);
    expect(events).toEqual([
      { type: "a", value: 9 },
      { type: "b", value: 12 },
      { type: "a", value: 9 },
      { type: "b", value: 12 },
    ]);

    expect(source.activeCount).toEqual(0);
    expect(source.completeCount).toEqual(1);
  });

  it("forwards a broken getKey", async () => {
    let throwError = false;
    const subject = new Subject<Payload>();
    const source = watchStream(
      subject.pipe(
        batchProcess(
          () => {
            if (throwError) {
              throw new Error("throw");
            }
            return "";
          },
          async (payloads) => {
            await delay(100);
            return payloads;
          },
        ),
      ),
    );

    const record = recordStream(source);

    subject.next({ type: "a", value: 1 });
    throwError = true;
    subject.next({ type: "a", value: 1 });

    await delay(1000);
    const { events, complete, error } = record();

    expect(error).not.toBeFalsy();
    expect(events.length).toEqual(0);
    expect(complete).toEqual(true);
    expect(source.activeCount).toEqual(0);
  });
});
