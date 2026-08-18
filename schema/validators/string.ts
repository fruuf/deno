import validator from "npm:validator";
import {
  Base64SchemaError,
  EmailSchemaError,
  IpSchemaError,
  MimeTypeSchemaError,
  StringLengthGTEError,
  StringLengthGTError,
  StringLengthLTEError,
  StringLengthLTError,
  UrlSchemaError,
  UuidSchemaError,
} from "../errors.ts";
import { StringSchema } from "../primitives.ts";
import { ExtendSchema } from "./core.ts";

/**
 * Schema for email addresses with validation.
 */
export const EmailSchema = ExtendSchema(StringSchema, (arg, path) => {
  if (validator.isEmail(arg)) return arg;
  throw new EmailSchemaError(path);
});

/**
 * Schema for UUID strings with validation.
 */
export const UuidSchema = ExtendSchema(StringSchema, (arg, path) => {
  if (validator.isUUID(arg)) {
    return arg;
  }
  throw new UuidSchemaError(path);
});

/**
 * Schema for URL strings with validation.
 */
export const UrlSchema = ExtendSchema(StringSchema, (arg, path) => {
  if (validator.isURL(arg, { require_tld: false, require_protocol: true })) {
    return arg;
  }
  throw new UrlSchemaError(path);
});

/**
 * Schema for IP addresses with CIDR notation support.
 */
export const IpSchema = ExtendSchema(StringSchema, (arg, path) => {
  const parsedArg = arg.replace(/\/.*$/, "");
  if (validator.isIP(parsedArg)) return parsedArg;
  throw new IpSchemaError(path);
});

/**
 * Schema for Base64 encoded strings with validation.
 */
export const Base64Schema = ExtendSchema(StringSchema, (arg, path) => {
  if (validator.isBase64(arg)) return arg;
  throw new Base64SchemaError(path);
});

/**
 * Schema for MIME type strings with validation.
 */
export const MimeTypeSchema = ExtendSchema(StringSchema, (arg, path) => {
  if (validator.isMimeType(arg)) return arg;
  throw new MimeTypeSchemaError(path);
});

/**
 * Creates a validator for string length greater than the specified limit.
 */
export const StringLengthGT =
  (limit: number) => (value: string, path: string) => {
    if (value.length > limit) return value;
    throw new StringLengthGTError(path, limit);
  };

/**
 * Creates a validator for string length greater than or equal to the specified limit.
 */
export const StringLengthGTE =
  (limit: number) => (value: string, path: string) => {
    if (value.length >= limit) return value;
    throw new StringLengthGTEError(path, limit);
  };

/**
 * Creates a validator for string length less than the specified limit.
 */
export const StringLengthLT =
  (limit: number) => (value: string, path: string) => {
    if (value.length < limit) return value;
    throw new StringLengthLTError(path, limit);
  };

/**
 * Creates a validator for string length less than or equal to the specified limit.
 */
export const StringLengthLTE =
  (limit: number) => (value: string, path: string) => {
    if (value.length <= limit) return value;
    throw new StringLengthLTEError(path, limit);
  };
