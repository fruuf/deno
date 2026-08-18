import {
  NumberGTEError,
  NumberGTError,
  NumberLTEError,
  NumberLTError,
} from "../errors.ts";

/**
 * Creates a validator for numbers greater than the specified limit.
 */
export const NumberGT = (limit: number) => (value: number, path: string) => {
  if (value > limit) return value;
  throw new NumberGTError(path, limit);
};

/**
 * Creates a validator for numbers greater than or equal to the specified limit.
 */
export const NumberGTE = (limit: number) => (value: number, path: string) => {
  if (value >= limit) return value;
  throw new NumberGTEError(path, limit);
};

/**
 * Creates a validator for numbers less than the specified limit.
 */
export const NumberLT = (limit: number) => (value: number, path: string) => {
  if (value < limit) return value;
  throw new NumberLTError(path, limit);
};

/**
 * Creates a validator for numbers less than or equal to the specified limit.
 */
export const NumberLTE = (limit: number) => (value: number, path: string) => {
  if (value <= limit) return value;
  throw new NumberLTEError(path, limit);
};
