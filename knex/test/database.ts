// 3e49382a25de7cc09b93911785fb21a984b3103a409c6ac4f7729ad6d6bdd59c
import { createTable } from "../table.ts";

export type TableBalance = {
  age: number | null;
  amount: number;
  currency: string;
  user_id: string;
  user_name: string;
  value: number;
};

export type Balance = {
  age: number | null;
  amount: number;
  currency: string;
  userId: string;
  userName: string;
  value: number;
};

export function parseBalanceRow(row: TableBalance): Balance {
  return {
    age: row.age === null ? null : row.age,
    amount: row.amount,
    currency: row.currency,
    userId: row.user_id,
    userName: row.user_name,
    value: row.value,
  };
}

export const tableBalance = createTable<TableBalance>("balance");

export type TableUser = {
  age: number | null;
  id: string;
  name: string;
};

export type User = {
  age: number | null;
  id: string;
  name: string;
};

export function parseUserRow(row: TableUser): User {
  return {
    age: row.age === null ? null : row.age,
    id: row.id,
    name: row.name,
  };
}

export const tableUser = createTable<TableUser>("user");
