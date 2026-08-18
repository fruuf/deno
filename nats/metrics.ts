import { meter } from "../metrics.ts";

/** Counter for total bytes written to NATS streams */
export const writeCount = meter.createCounter("nats_write_count", {
  //   name: "nats_write_count",
  //   help: "nats_write_count",
  //   labelNames: ["stream", "producer"],
});

/** Counter for total messages written to NATS streams */
export const writeMsgCount = meter.createCounter("nats_messages_write", {
  //   name: "nats_messages_write",
  //   help: "nats_messages_write",
  //   labelNames: ["stream", "producer"],
});

/** Histogram tracking NATS message payload sizes in bytes */
export const payloadSizeHistogram = meter.createHistogram(
  "nats_message_payload_size",
  {
    //   name: "nats_message_payload_size",
    //   help: "nats_message_payload_size",
    //   labelNames: ["stream", "producer"],
    //   buckets: [256000, 512000, 1024000, 2048000, 4096000, 8192000], // in bytes
  },
);

/** Counter for total bytes read from NATS streams */
export const readCount = meter.createCounter("nats_read_count", {
  //   name: "nats_read_count",
  //   help: "nats_read_count",
  //   labelNames: ["stream", "producer", "queue"],
});

/** Counter for total messages read from NATS streams */
export const readMsgCount = meter.createCounter("nats_messages_read", {
  //   name: "nats_messages_read",
  //   help: "nats_messages_read",
  //   labelNames: ["stream", "producer", "queue"],
});

/** Gauge tracking pending messages in NATS subscriptions */
export const subPendingMsgGauge = meter.createGauge("nats_messages_pending", {
  //   name: "nats_messages_pending",
  //   help: "nats_messages_pending",
  //   labelNames: ["stream", "producer", "queue"],
});

/** Gauge tracking total messages received by NATS subscriptions */
export const subReceivedMsgGauge = meter.createGauge("nats_messages_received", {
  //   name: "nats_messages_received",
  //   help: "nats_messages_received",
  //   labelNames: ["stream", "producer", "queue"],
});

/** Gauge tracking total messages processed by NATS subscriptions */
export const subProcessedMsgGauge = meter.createGauge(
  "nats_messages_received",
  {
    //   name: "nats_messages_processed",
    //   help: "nats_messages_processed",
    //   labelNames: ["stream", "producer", "queue"],
  },
);

/** Emits metrics for NATS stream write operations including size and count */
export function emitWriteMetrics({
  subject,
  host,
  messageByteLength,
}: {
  subject: string;
  host: string;
  messageByteLength: number;
}) {
  const labels = { stream: subject, producer: host };
  writeCount.add(messageByteLength, labels);
  writeMsgCount.add(1, labels);
  payloadSizeHistogram.record(messageByteLength, labels);
}

/** Emits metrics for NATS stream read operations including queue stats */
export function emitReadMetrics({
  subject,
  host,
  queue,
  messageByteLength,
  subPendingMessages,
  subReceivedMessages,
  subProcessedMessages,
}: {
  subject: string;
  host: string;
  queue?: string;
  messageByteLength: number;
  subPendingMessages: number;
  subReceivedMessages: number;
  subProcessedMessages: number;
}) {
  const labels = queue
    ? {
      stream: subject,
      producer: host,
      queue,
    }
    : {
      stream: subject,
      producer: host,
    };

  readCount.add(messageByteLength, labels);
  readMsgCount.add(1, labels);
  subPendingMsgGauge.record(subPendingMessages, labels);
  subReceivedMsgGauge.record(subReceivedMessages, labels);
  subProcessedMsgGauge.record(subProcessedMessages, labels);
}
