// deno-lint-ignore-file no-explicit-any
import { configString } from "../config.ts";

/** Configuration for NATS request host, defaults to 'nats-request' */
export const nats_request_host = configString(
  `nats_request_host`,
  `nats-request`,
);

/** Type for async server method handlers that accept arguments and return a result */
export type ServerMethod<Args extends unknown[], Result> = (
  ...args: Args
) => Promise<Result>;

/** Extracts argument types from a ServerMethod type */
export type ServerMethodArgs<Method> = Method extends
  ServerMethod<infer Args, any> ? Args : never;

/** Extracts return type from a ServerMethod type */
export type ServerMethodResult<Method> = Method extends
  ServerMethod<any, infer Result> ? Result : never;

/** Successful server response containing result data */
export type ServerResponseResult<Result> = {
  type: "result";
  data: Result;
};

/** Error response from server containing error details */
export type ServerResponseError = {
  type: "error";
  error: {
    message: string;
    errorType: string;
  };
};

/** Union type for all possible server responses (success or error) */
export type ServerResponse<Result> =
  | ServerResponseResult<Result>
  | ServerResponseError;

/** Client-side API method with plugin support, stubbing, and metadata */
export type ApiMethod<Args extends unknown[], Result> =
  & ((
    ...args: Args
  ) => Promise<Result>)
  & {
    plugin: (plugin: string, ...args: Args) => Promise<Result>;
    methodHost: string;
    methodName: string;
    timeout: number;
    stub: (handler: ServerMethod<Args, Result>) => void;
    unstub: () => void;
  };
