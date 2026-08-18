import FormData from "npm:form-data";
import { SafeError } from "../error.ts";
import { Json } from "../util.ts";

export type Method = "GET" | "PATCH" | "POST" | "PUT" | "DELETE" | "FORM";

export type HeaderHandler = (config: {
  method: Method;
  headers: Record<string, string>;
  body?: Uint8Array | string;
}) => string | undefined | null;

export type RequestOptions = {
  headers?: Record<string, string | HeaderHandler>;
  timeout?: number;
  parse?: "json" | "yaml" | "text" | "xml";
  encoding?: "json" | "form" | "xml";
};

/**
 * Error thrown when HTTP request fails.
 */
export class RequestFailedError extends SafeError {
  constructor() {
    super("requestFailed", "requestFailed");
  }
}

/**
 * Error thrown when response parsing/validation fails.
 */
export class RequestParseError extends SafeError {
  parseError: string;
  constructor(schemaError: string) {
    super("requestParse", "requestParse");
    this.parseError = schemaError;
  }
}

export type RequestData = Uint8Array<ArrayBuffer> | string | undefined;
export type ParseFormat = "json" | "yaml" | "text" | "xml";
export type EncodingFormat = "json" | "form" | "xml";
export type RequestBody = Json | FormData | null;
