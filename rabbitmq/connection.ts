// @ts-types="npm:@types/amqplib"
import { ChannelModel, connect } from "npm:amqplib";
import {
  catchError,
  distinctUntilChanged,
  startWith,
  switchMap,
  takeUntil,
  timer,
} from "npm:rxjs";
import { configNumber, configString } from "../config.ts";
import { cacheObservable, createAsyncObservable } from "../core.ts";
import { errorHandler } from "../error.ts";
import { cleanupStream } from "../service.ts";

const RABBITMQ_HOST = configString(`rabbitmq_host`, "rabbitmq");
const RABBITMQ_PORT = configNumber(`rabbitmq_port`, 5672);
const RABBITMQ_USERNAME = configString(`rabbitmq_username`, "guest");
const RABBITMQ_PASSWORD = configString(`rabbitmq_password`, "guest");
const RABBITMQ_PROTOCOL = configString(`rabbitmq_protocol`, "amqp");
const RABBITMQ_VHOST = configString(`rabbitmq_vhost`, "/");

/**
 * Creates and manages a RabbitMQ connection with automatic reconnection.
 */
export const ensureConnection = cacheObservable(
  () =>
    createAsyncObservable<ChannelModel | null>(async (observer, cleanup) => {
      const connection = await connect(
        {
          protocol: RABBITMQ_PROTOCOL,
          hostname: RABBITMQ_HOST,
          port: RABBITMQ_PORT,
          username: RABBITMQ_USERNAME,
          password: RABBITMQ_PASSWORD,
          vhost: RABBITMQ_VHOST,
          frameMax: 0,
          heartbeat: 10,
        },
        { rejectUnauthorized: false },
      );

      connection.on("error", (error: Error) => observer.error(error));
      connection.on("close", () => observer.error(Error("connection closed")));
      cleanup(() => connection.close());
      observer.next(connection);
    }).pipe(
      startWith(null),
      catchError((e, observable) => {
        errorHandler(e);
        return timer(5000).pipe(
          switchMap(() => observable),
          startWith(null),
        );
      }),
      distinctUntilChanged(),
      takeUntil(cleanupStream),
    ),
  null,
  10000,
  1,
);
