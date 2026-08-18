// deno-lint-ignore-file no-explicit-any

/**
 * Parse function type that transforms input values to schema types.
 */
type Parse<Schema> = (arg: any, path?: string) => Schema;

/**
 * Union of all possible schema types in the system.
 */
export type SchemaType =
  | NullSchema
  | StringSchema
  | IntegerSchema
  | FloatSchema
  | BooleanSchema
  | DateSchema
  | LiteralSchema<any>
  | EnumSchema<any>
  | UnionSchema<any>
  | OptionalSchema<any>
  | ArraySchema<any>
  | RecordSchema<any>;

/**
 * Extracts the static TypeScript type from a schema definition.
 */
export type StaticSchema<Schema extends SchemaType> = Schema["_schema"];

/**
 * Schema type for null values.
 */
export type NullSchema = {
  type: "null";
  parse: Parse<null>;
  _schema: null;
};

/**
 * Schema type for string values.
 */
export type StringSchema = {
  type: "string";
  parse: Parse<string>;
  _schema: string;
};

/**
 * Schema type for integer number values.
 */
export type IntegerSchema = {
  type: "integer";
  parse: Parse<number>;
  _schema: number;
};

/**
 * Schema type for floating-point number values.
 */
export type FloatSchema = {
  type: "float";
  parse: Parse<number>;
  _schema: number;
};

/**
 * Schema type for boolean values.
 */
export type BooleanSchema = {
  type: "boolean";
  parse: Parse<boolean>;
  _schema: boolean;
};

/**
 * Schema type for date values (returns timestamp number).
 */
export type DateSchema = {
  type: "date";
  parse: Parse<number>;
  _schema: number;
};

/**
 * Schema type for literal string values.
 */
export type LiteralSchema<Value extends string> = {
  type: "literal";
  value: Value;
  parse: Parse<Value>;
  _schema: Value;
};

/**
 * Function type for creating enum value schemas.
 */
type EnumValue<Value extends string> = <Item extends Value>(
  value: Item,
) => LiteralSchema<Item>;

/**
 * Core enum definition interface.
 */
type EnumDefinition<Value extends string> = {
  type: "enum";
  values: Value[];
  parse: Parse<Value>;
  test(value: string): value is Value;
};

/**
 * Schema type for enum values with validation methods.
 */
export type EnumSchema<Value extends string> =
  & {
    _schema: Value;
  }
  & EnumDefinition<Value>
  & EnumValue<Value>;

/**
 * Schema type for union of multiple schema types.
 */
export type UnionSchema<Item extends SchemaType> = {
  type: "union";
  items: Item[];
  parse: Parse<StaticSchema<Item>>;
  _schema: StaticSchema<Item>;
};

/**
 * Schema type for optional values (allows null).
 */
export type OptionalSchema<Schema extends SchemaType> = {
  type: "optional";
  base: Schema;
  parse: Parse<StaticSchema<Schema> | null>;
  _schema: StaticSchema<Schema> | null;
};

/**
 * Schema type for arrays of validated values.
 */
export type ArraySchema<Schema extends SchemaType> = {
  type: "array";
  base: Schema;
  parse: Parse<StaticSchema<Schema>[]>;
  _schema: StaticSchema<Schema>[];
};

/**
 * Utility type for extracting static types from record schemas.
 */
export type StaticRecordSchema<Schema> = Schema extends
  Record<string, SchemaType> ? {
    [K in keyof Schema]: StaticSchema<Schema[K]>;
  }
  : never;

/**
 * Schema type for object records with typed fields.
 */
export type RecordSchema<Fields extends Record<string, SchemaType>> = {
  type: "record";
  fields: Fields;
  parse: Parse<StaticRecordSchema<Fields>>;
  _schema: StaticRecordSchema<Fields>;
};
