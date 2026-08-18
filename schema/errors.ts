import { SafeError } from "../error.ts";

/**
 * Base class for all schema validation errors.
 */
export class SchemaError extends SafeError {
  path: string;
  constructor(type: string, path: string) {
    const upperType = type.charAt(0).toUpperCase() + type.slice(1);
    super(`invalid${upperType}`, "schemaError");
    this.path = path;
  }
}

/**
 * Error thrown when string validation fails.
 */
export class StringSchemaError extends SchemaError {
  constructor(path: string) {
    super("string", path);
  }
}

/**
 * Error thrown when integer validation fails.
 */
export class IntegerSchemaError extends SchemaError {
  constructor(path: string) {
    super("integer", path);
  }
}

/**
 * Error thrown when float validation fails.
 */
export class FloatSchemaError extends SchemaError {
  constructor(path: string) {
    super("float", path);
  }
}

/**
 * Error thrown when boolean validation fails.
 */
export class BooleanSchemaError extends SchemaError {
  constructor(path: string) {
    super("boolean", path);
  }
}

/**
 * Error thrown when date validation fails.
 */
export class DateSchemaError extends SchemaError {
  constructor(path: string) {
    super("date", path);
  }
}

/**
 * Error thrown when literal value validation fails.
 */
export class LiteralSchemaError extends SchemaError {
  constructor(path: string) {
    super("literal", path);
  }
}

/**
 * Error thrown when enum validation fails.
 */
export class EnumSchemaError extends SchemaError {
  constructor(path: string) {
    super("enum", path);
  }
}

/**
 * Error thrown when union validation fails.
 */
export class UnionSchemaError extends SchemaError {
  constructor(path: string) {
    super("union", path);
  }
}

/**
 * Error thrown when array validation fails.
 */
export class ArraySchemaError extends SchemaError {
  constructor(path: string) {
    super("array", path);
  }
}

/**
 * Error thrown when record validation fails.
 */
export class RecordSchemaError extends SchemaError {
  constructor(path: string) {
    super("record", path);
  }
}

/**
 * Error thrown when email validation fails.
 */
export class EmailSchemaError extends SchemaError {
  constructor(path: string) {
    super("email", path);
  }
}

/**
 * Error thrown when UUID validation fails.
 */
export class UuidSchemaError extends SchemaError {
  constructor(path: string) {
    super("uuid", path);
  }
}

/**
 * Error thrown when URL validation fails.
 */
export class UrlSchemaError extends SchemaError {
  constructor(path: string) {
    super("url", path);
  }
}

/**
 * Error thrown when IP address validation fails.
 */
export class IpSchemaError extends SchemaError {
  constructor(path: string) {
    super("ip", path);
  }
}

/**
 * Error thrown when Base64 validation fails.
 */
export class Base64SchemaError extends SchemaError {
  constructor(path: string) {
    super("base64", path);
  }
}

/**
 * Error thrown when MIME type validation fails.
 */
export class MimeTypeSchemaError extends SchemaError {
  constructor(path: string) {
    super("mimeType", path);
  }
}

/**
 * Error thrown when number greater than validation fails.
 */
export class NumberGTError extends SchemaError {
  limit: number;
  constructor(path: string, limit: number) {
    super("numberGreater", path);
    this.limit = limit;
  }
}

/**
 * Error thrown when number greater than or equal validation fails.
 */
export class NumberGTEError extends SchemaError {
  limit: number;
  constructor(path: string, limit: number) {
    super("numberGreaterEqual", path);
    this.limit = limit;
  }
}

/**
 * Error thrown when number less than validation fails.
 */
export class NumberLTError extends SchemaError {
  limit: number;
  constructor(path: string, limit: number) {
    super("numberLess", path);
    this.limit = limit;
  }
}

/**
 * Error thrown when number less than or equal validation fails.
 */
export class NumberLTEError extends SchemaError {
  limit: number;
  constructor(path: string, limit: number) {
    super("numberLessEqual", path);
    this.limit = limit;
  }
}

/**
 * Error thrown when string length greater than validation fails.
 */
export class StringLengthGTError extends SchemaError {
  limit: number;
  constructor(path: string, limit: number) {
    super("stringLengthGreater", path);
    this.limit = limit;
  }
}

/**
 * Error thrown when string length greater than or equal validation fails.
 */
export class StringLengthGTEError extends SchemaError {
  limit: number;
  constructor(path: string, limit: number) {
    super("stringLengthGreaterEqual", path);
    this.limit = limit;
  }
}

/**
 * Error thrown when string length less than validation fails.
 */
export class StringLengthLTError extends SchemaError {
  limit: number;
  constructor(path: string, limit: number) {
    super("stringLengthLess", path);
    this.limit = limit;
  }
}

/**
 * Error thrown when string length less than or equal validation fails.
 */
export class StringLengthLTEError extends SchemaError {
  limit: number;
  constructor(path: string, limit: number) {
    super("stringLengthLessEqual", path);
    this.limit = limit;
  }
}
