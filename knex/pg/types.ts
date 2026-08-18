// deno-lint-ignore-file no-explicit-any
import { Json } from "../../util.ts";

export type PgString = {
  type: "string";
  default?: string;
  _pg: string;
};

export type PgText = {
  type: "text";
  default?: string;
  _pg: string;
};

export type PgUuid = {
  type: "uuid";
  default?: string;
  _pg: string;
};

export type PgInteger = {
  type: "integer";
  default?: number;
  _pg: number;
};

export type PgFloat = {
  type: "float";
  default?: number;
  _pg: number;
};

export type PgDecimal = {
  type: "decimal";
  default?: bigint;
  _pg: bigint;
};

export type PgBoolean = {
  type: "boolean";
  default?: boolean;
  _pg: boolean;
};

export type PgDate = {
  type: "date";
  default?: string;
  _pg: Date;
};

export type PgEnum<Value extends string> = {
  type: "enum";
  values: Value[];
  default?: Value;
  _pg: Value;
};

export type PgJson<Data extends Json> = {
  type: "json";
  default?: Data;
  _pg: Data;
};

export type PgReference<Table extends PgTable<any>> = {
  type: "reference";
  default?: string;
  table: Table;
  _pg: string;
};

export type NullableColumns =
  | PgString
  | PgText
  | PgUuid
  | PgInteger
  | PgFloat
  | PgDecimal
  | PgBoolean
  | PgDate
  | PgEnum<any>
  | PgJson<any>
  | PgReference<any>;

export type PgNullable<Column extends NullableColumns> = {
  type: "nullable";
  column: Column;
  default?: Column["_pg"];
  _pg: Column["_pg"] | null;
};

type ResolveForwardType<Column extends PgColumn> = Column extends
  PgForward<any, any, any> ? Column["_source"]
  : Column;

type ResolveForward<Source extends PgColumn, Reference extends PgColumn> =
  Reference extends PgNullable<any> ? StaticPg<Source> | null
    : StaticPg<Source>;

export type PgForward<
  Table extends PgTable<any>,
  Key extends keyof StaticPg<Table>,
  Reference extends
    | PgReference<Table>
    | PgForward<any, any, any>
    | PgNullable<PgReference<Table>>,
> = {
  type: "forward";
  table: Table;
  key: Key;
  reference: Reference;
  _source: ResolveForwardType<Table["_columns"][Key]>;
  _pg: ResolveForward<
    ResolveForwardType<Table["_columns"][Key]>,
    ResolveForwardType<Reference>
  >;
};

export type PgColumn =
  | PgString
  | PgText
  | PgUuid
  | PgInteger
  | PgFloat
  | PgDecimal
  | PgBoolean
  | PgDate
  | PgEnum<any>
  | PgJson<any>
  | PgReference<any>
  | PgNullable<any>
  | PgForward<any, any, any>;

export type PgColumns = Record<string, PgColumn>;

export type StaticPg<Pg extends (PgColumn | PgTable<any>)> = Pg["_pg"];

type StaticColumns<Columns> = Columns extends Record<string, PgColumn> ? {
    [K in keyof Columns]: StaticPg<Columns[K]>;
  }
  : never;

export type PgTable<Columns extends PgColumns> = {
  name: string;
  schema: PgSchema;
  _pg: StaticColumns<
    { id: PgUuid } & Columns & { created_at: PgDate; updated_at: PgDate }
  >;
  _columns: { id: PgUuid } & Columns & {
    created_at: PgDate;
    updated_at: PgDate;
  };
};

export type PgSchema = {
  name: string;
  tables: Record<string, (() => PgColumns)[]>;
  indexes: Index[];
};

export type UniqueIndex = {
  type: "unique";
  table: string;
  columns: string[];
  where: Record<string, unknown>;
};

export type SortIndex = {
  type: "sort";
  table: string;
  columns: string[];
  where: Record<string, unknown>;
  orders: string[];
};

export type Index = UniqueIndex | SortIndex;

export type QueryParameters<Columns> = Columns extends Record<string, PgColumn>
  ? {
    [K in keyof Columns]: StaticPg<Columns[K]> | StaticPg<Columns[K]>[];
  }
  : never;

export type PgTableParameters<
  Table extends PgTable<any>,
  Key extends keyof StaticPg<Table>,
> = QueryParameters<
  Pick<Table["_columns"], Key>
>;

export type PgHelper<T> = {
  type: T;
  query: string;
  bindings: unknown[];
};

export type Where<
  Columns extends Record<string, any>,
  Key extends keyof Columns,
> = {
  [K in Key]: Columns[K] | Columns[K][] | PgHelper<Columns[K]>;
};

export type Table = {
  name: string;
  columns: PgColumns;
  indexes: Index[];
};
