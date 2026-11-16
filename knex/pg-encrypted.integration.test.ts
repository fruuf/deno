import { decodeBase64, encodeBase64 } from "jsr:@std/encoding";
import { expect } from "jsr:@std/expect/expect";
import { before, describe, it } from "jsr:@std/testing/bdd";
import { getKnex, setupKnex } from "./knex.ts";
import {
  applySchema,
  createEncryption,
  pgEncrypted,
  pgNullable,
  pgSchema,
  pgString,
  pgTable,
  pgText,
  StaticPg,
} from "./pg.ts";
import {
  encryptedKeyId,
  isEncryptedValue,
  overrideEncryptionKeys,
  parseKeys,
} from "./pg/encryption.ts";
import { TableSchemaEncrypt } from "./pg/internal.ts";
import {
  drainSchemaEncrypt,
  processSchemaEncrypt,
} from "./pg/schema-encrypt.ts";

// several batches of five, with a partial one at the end
const ROWS = 23;
const DEV_KEY = encodeBase64(new Uint8Array(32));

async function constraintNames(table: string) {
  const knex = getKnex("test");
  const rows = await knex("information_schema.table_constraints")
    .select<{ constraint_name: string }[]>("constraint_name")
    .where({
      table_schema: "public",
      table_name: table,
      constraint_type: "CHECK",
    })
    .where("constraint_name", "like", "%\\_encrypted\\_%");
  return rows.map((row) => row.constraint_name);
}

describe("pg encrypted columns", () => {
  before(async () => {
    await setupKnex("test");
  });

  it("round trips values and rejects unknown keys", () => {
    const { encrypt, decrypt, activeKeyId } = createEncryption("test");
    const encrypted = encrypt("secret");
    expect(isEncryptedValue(encrypted)).toBe(true);
    expect(encryptedKeyId(encrypted)).toBe(activeKeyId());
    expect(encrypted).not.toContain("secret");
    expect(decrypt(encrypted)).toBe("secret");
    // plaintext passes through until the schema job has encrypted the rows
    expect(decrypt("plain")).toBe("plain");
    expect(encryptedKeyId("plain")).toBe(null);
    // two encryptions of the same value use different message ids and ivs
    expect(encrypt("secret")).not.toBe(encrypted);
    expect(() => decrypt(encrypted.replace(":dev:", ":other:"))).toThrow(
      "unknown encryption key",
    );
  });

  it("derives a key per value from its message id", () => {
    const { encrypt, decrypt } = createEncryption("test");
    const [prefix, keyId, payload] = encrypt("secret").split(":");
    const bytes = decodeBase64(payload);
    // message id (32) | iv (12) | tag (16) | ciphertext
    expect(bytes.length).toBe(32 + 12 + 16 + "secret".length);

    // the message id feeds the key derivation, changing it breaks decryption
    const tampered = new Uint8Array(bytes);
    tampered[0] ^= 1;
    expect(() =>
      decrypt(`${prefix}:${keyId}:${encodeBase64(tampered)}` as never)
    ).toThrow();

    expect(() =>
      decrypt(
        `${prefix}:${keyId}:${encodeBase64(bytes.subarray(0, 40))}` as never,
      )
    )
      .toThrow("malformed encrypted value");
  });

  it("parses key lists with the active key first", () => {
    const key = DEV_KEY;
    const keys = parseKeys(`k2:${key}, k1:${key}`);
    expect(keys.map(({ id }) => id)).toEqual(["k2", "k1"]);
    expect(() => parseKeys(`k1:${btoa("short")}`)).toThrow("32 bytes");
    expect(() => parseKeys(`k1:${key},k1:${key}`)).toThrow("duplicate");
    expect(() => parseKeys("")).toThrow("no encryption keys");
  });

  it("encrypts existing rows in the background", async () => {
    const knex = getKnex("test");
    const { decrypt, encrypt } = createEncryption("test");

    const plainSchema = pgSchema("encrypted_plain");
    const plainTable = pgTable(plainSchema, "secret", () => ({
      value: pgNullable(pgString()),
    }));
    type TablePlain = StaticPg<typeof plainTable>;
    await applySchema("test", null, plainSchema);

    await knex<TablePlain>("secret").insert(
      Array.from({ length: ROWS }, (_, index) => ({ value: `plain-${index}` })),
    );
    await knex<TablePlain>("secret").insert({ value: null });

    const encryptedSchema = pgSchema("encrypted_plain");
    const encryptedTable = pgTable(encryptedSchema, "secret", () => ({
      value: pgNullable(pgEncrypted()),
    }));
    type TableEncrypted = StaticPg<typeof encryptedTable>;
    await applySchema("test", null, encryptedSchema);

    // the schema applies without touching rows, the column is only recorded
    const [job] = await knex<TableSchemaEncrypt>("schema_encrypt").where({
      schema: "encrypted_plain",
      table: "secret",
    });
    expect(job).toMatchObject({
      column: "value",
      key: "dev",
      cursor: null,
      completed: false,
    });
    expect(await constraintNames("secret")).toEqual([]);
    const [untouched] = await knex<TableEncrypted>("secret")
      .where("value", "plain-0");
    expect(untouched.value).toBe("plain-0");

    await drainSchemaEncrypt("test", "encrypted_plain");

    const rows = await knex<TableEncrypted>("secret").orderBy("created_at");
    expect(rows.length).toBe(ROWS + 1);
    const values = rows.map((row) => row.value);
    const encryptedValues = values.filter((value) => value !== null);
    expect(encryptedValues.length).toBe(ROWS);
    expect(encryptedValues.every((value) => isEncryptedValue(value))).toBe(
      true,
    );
    expect(
      new Set(encryptedValues.map((value) => decrypt(value))),
    ).toEqual(new Set(Array.from({ length: ROWS }, (_, i) => `plain-${i}`)));

    const [completed] = await knex<TableSchemaEncrypt>("schema_encrypt")
      .where("id", job.id);
    expect(completed.completed).toBe(true);
    expect(completed.cursor).toBe(null);
    expect(await constraintNames("secret")).toEqual(["secret_encrypted_value"]);

    // draining again is a no-op
    await drainSchemaEncrypt("test", "encrypted_plain");

    // plaintext is rejected now, encrypted values and null are accepted
    await expect(
      knex<TablePlain>("secret").insert({ value: "plain" }),
    ).rejects.toThrow("secret_encrypted_value");
    await knex<TableEncrypted>("secret").insert({ value: encrypt("new") });
    await knex<TableEncrypted>("secret").insert({ value: null });

    // re-applying the same schema leaves the completed row alone
    await applySchema("test", null, encryptedSchema);
    const jobs = await knex<TableSchemaEncrypt>("schema_encrypt").where({
      schema: "encrypted_plain",
      table: "secret",
    });
    expect(jobs.map((job) => job.completed)).toEqual([true]);

    // switching the column back drops the constraint again, text rather than
    // string because a schema hash that was applied before is skipped
    const revertedSchema = pgSchema("encrypted_plain");
    pgTable(revertedSchema, "secret", () => ({
      value: pgNullable(pgText()),
    }));
    await applySchema("test", null, revertedSchema);
    expect(await constraintNames("secret")).toEqual([]);
    await knex<TablePlain>("secret").insert({ value: "plain" });
    // the row of the column is gone with it
    expect(
      await knex<TableSchemaEncrypt>("schema_encrypt").where("table", "secret"),
    ).toEqual([]);

    // a pod of the release that encrypted the column changes nothing when it
    // starts now, its schema is no longer the active one
    await applySchema("test", null, encryptedSchema);
    expect(
      await knex<TableSchemaEncrypt>("schema_encrypt").where("table", "secret"),
    ).toEqual([]);

    // encrypting again takes a new schema, which records a fresh row that
    // picks up the plaintext row
    const againSchema = pgSchema("encrypted_plain");
    pgTable(againSchema, "secret", () => ({
      value: pgNullable(pgEncrypted()),
      note: pgNullable(pgText()),
    }));
    await applySchema("test", null, againSchema);
    expect(await constraintNames("secret")).toEqual([]);
    const pending = await knex<TableSchemaEncrypt>("schema_encrypt")
      .where("table", "secret");
    expect(pending.map((job) => job.completed)).toEqual([false]);
    await drainSchemaEncrypt("test", "encrypted_plain");
    expect(await constraintNames("secret")).toEqual(["secret_encrypted_value"]);
    // a restart with everything in place changes nothing
    await applySchema("test", null, againSchema);
    const settled = await knex<TableSchemaEncrypt>("schema_encrypt")
      .where("table", "secret");
    expect(settled.map((job) => job.completed)).toEqual([true]);
    expect(
      await knex<TableEncrypted>("secret")
        .whereNotNull("value")
        .whereNot("value", "like", "enc:%"),
    ).toEqual([]);
  });

  it("leaves the constraint out until the column is enforced", async () => {
    const knex = getKnex("test");
    const { encrypt } = createEncryption("test");
    const unenforcedSchema = pgSchema("encrypted_unenforced");
    const table = pgTable(unenforcedSchema, "unenforced", () => ({
      value: pgEncrypted(false),
    }));
    type Row = StaticPg<typeof table>;
    const enforcedSchema = pgSchema("encrypted_unenforced");
    pgTable(enforcedSchema, "unenforced", () => ({ value: pgEncrypted() }));
    const status = () =>
      knex<TableSchemaEncrypt>("schema_encrypt")
        .where({ schema: "encrypted_unenforced", table: "unenforced" })
        .first();
    const plainRows = () =>
      knex<Row>("unenforced").whereNot("value", "like", "enc:%");

    await applySchema("test", null, unenforcedSchema);
    await knex<Row>("unenforced").insert([
      { value: encrypt("a") },
      { value: "b" as never },
    ]);
    await drainSchemaEncrypt("test", "encrypted_unenforced");
    expect(await status()).toMatchObject({ enforced: false, completed: true });
    expect(await plainRows()).toEqual([]);
    expect(await constraintNames("unenforced")).toEqual([]);

    // pods that do not encrypt yet can still write, a restart leaves it alone
    await knex<Row>("unenforced").insert({ value: "late" as never });
    await applySchema("test", null, unenforcedSchema);
    expect(await status()).toMatchObject({ enforced: false, completed: true });

    // enforcing checks the rows again before the constraint is added
    await applySchema("test", null, enforcedSchema);
    expect(await status()).toMatchObject({ enforced: true, completed: false });
    expect(await constraintNames("unenforced")).toEqual([]);

    // a pod that still declares the column unenforced does not take it back
    // and completes the column with the constraint
    await applySchema("test", null, unenforcedSchema);
    expect(await status()).toMatchObject({ enforced: true, completed: false });
    await drainSchemaEncrypt("test", "encrypted_unenforced");
    expect(await status()).toMatchObject({ enforced: true, completed: true });
    expect(await plainRows()).toEqual([]);
    expect(await constraintNames("unenforced")).toEqual([
      "unenforced_encrypted_value",
    ]);
    await expect(
      knex<Row>("unenforced").insert({ value: "plain" as never }),
    ).rejects.toThrow("unenforced_encrypted_value");

    // nor does its restart drop the constraint
    await applySchema("test", null, unenforcedSchema);
    expect(await status()).toMatchObject({ enforced: true, completed: true });
    expect(await constraintNames("unenforced")).toEqual([
      "unenforced_encrypted_value",
    ]);

    // and a new release that declares it unenforced again keeps it as well
    const relaxedSchema = pgSchema("encrypted_unenforced");
    pgTable(relaxedSchema, "unenforced", () => ({
      value: pgEncrypted(false),
      note: pgNullable(pgText()),
    }));
    await applySchema("test", null, relaxedSchema);
    expect(await status()).toMatchObject({ enforced: true, completed: true });
    expect(await constraintNames("unenforced")).toEqual([
      "unenforced_encrypted_value",
    ]);
  });

  it("leaves the job alone when an older release starts later", async () => {
    const knex = getKnex("test");
    const plainSchema = pgSchema("encrypted_stale");
    const plainTable = pgTable(plainSchema, "stale", () => ({
      value: pgString(),
    }));
    type Plain = StaticPg<typeof plainTable>;
    const encryptedSchema = pgSchema("encrypted_stale");
    pgTable(encryptedSchema, "stale", () => ({ value: pgEncrypted(false) }));
    const status = () =>
      knex<TableSchemaEncrypt>("schema_encrypt")
        .where({ schema: "encrypted_stale", table: "stale" })
        .first();

    await applySchema("test", null, plainSchema);
    await knex<Plain>("stale").insert(
      Array.from({ length: 7 }, (_, index) => ({ value: `plain-${index}` })),
    );
    await applySchema("test", null, encryptedSchema);
    // one batch of five, two rows are left
    expect(await processSchemaEncrypt("test", "encrypted_stale")).toBe(true);
    const { cursor } = (await status())!;
    expect(cursor).not.toBe(null);

    // a pod of the previous release starts after the new one. The column is
    // not encrypted in its schema, but the job is not its to remove
    await applySchema("test", null, plainSchema);
    expect(await status()).toMatchObject({ cursor, completed: false });

    await drainSchemaEncrypt("test", "encrypted_stale");
    expect(await status()).toMatchObject({ completed: true });
    expect(
      await knex<Plain>("stale").whereNot("value", "like", "enc:%"),
    ).toEqual([]);
  });

  it("re-encrypts a column after a key rotation", async () => {
    const knex = getKnex("test");
    const { encrypt, decrypt, activeKeyId } = createEncryption("test");
    const schema = pgSchema("encrypted_rotation");
    const table = pgTable(schema, "rotated", () => ({
      value: pgEncrypted(),
    }));
    type Row = StaticPg<typeof table>;
    const status = () =>
      knex<TableSchemaEncrypt>("schema_encrypt")
        .where({ schema: "encrypted_rotation", table: "rotated" })
        .first();

    await applySchema("test", null, schema);
    await knex<Row>("rotated").insert([
      { value: encrypt("a") },
      { value: "b" as never },
    ]);
    await drainSchemaEncrypt("test", "encrypted_rotation");
    expect(await status()).toMatchObject({
      column: "value",
      key: "dev",
      cursor: null,
      completed: true,
    });

    // the rotated key list keeps the previous key, so old rows stay readable
    const k2 = encodeBase64(crypto.getRandomValues(new Uint8Array(32)));
    overrideEncryptionKeys("test", `k2:${k2},dev:${DEV_KEY}`);
    expect(activeKeyId()).toBe("k2");
    expect(decrypt(encrypt("c"))).toBe("c");
    const before = await knex<Row>("rotated");
    expect(before.map((row) => encryptedKeyId(row.value)).sort()).toEqual([
      "dev",
      "dev",
    ]);
    expect(before.map((row) => decrypt(row.value)).sort()).toEqual(["a", "b"]);

    // the next startup resets the column to the new key
    await applySchema("test", null, schema);
    expect(await status()).toMatchObject({
      key: "k2",
      cursor: null,
      completed: false,
    });
    expect(await constraintNames("rotated")).toEqual([
      "rotated_encrypted_value",
    ]);

    // a process that still runs the previous key leaves the column alone
    overrideEncryptionKeys("test", `dev:${DEV_KEY}`);
    expect(await processSchemaEncrypt("test", "encrypted_rotation")).toBe(
      false,
    );
    expect(await status()).toMatchObject({ key: "k2", completed: false });

    overrideEncryptionKeys("test", `k2:${k2},dev:${DEV_KEY}`);
    await drainSchemaEncrypt("test", "encrypted_rotation");
    const rows = await knex<Row>("rotated");
    expect(rows.map((row) => encryptedKeyId(row.value))).toEqual(["k2", "k2"]);
    expect(rows.map((row) => decrypt(row.value)).sort()).toEqual(["a", "b"]);
    expect(await status()).toMatchObject({
      key: "k2",
      cursor: null,
      completed: true,
    });
    expect(await constraintNames("rotated")).toEqual([
      "rotated_encrypted_value",
    ]);

    // a restart with the same key changes nothing
    await applySchema("test", null, schema);
    expect(await status()).toMatchObject({ key: "k2", completed: true });

    overrideEncryptionKeys("test", `dev:${DEV_KEY}`);
  });

  it("picks up rows that older pods write while it runs", async () => {
    const knex = getKnex("test");
    const { decrypt } = createEncryption("test");
    const k2 = encodeBase64(crypto.getRandomValues(new Uint8Array(32)));
    const current = `k2:${k2},dev:${DEV_KEY}`;
    overrideEncryptionKeys("test", current);
    // what a pod that still runs the previous key writes
    const encryptOld = (value: string) => {
      overrideEncryptionKeys("test", `dev:${DEV_KEY}`);
      const encrypted = createEncryption("test").encrypt(value);
      overrideEncryptionKeys("test", current);
      return encrypted;
    };

    const schema = pgSchema("encrypted_concurrent");
    const table = pgTable(schema, "concurrent", () => ({
      value: pgEncrypted(),
    }));
    type Row = StaticPg<typeof table>;
    const status = () =>
      knex<TableSchemaEncrypt>("schema_encrypt")
        .where({ schema: "encrypted_concurrent", table: "concurrent" })
        .first();
    const expected = new Set<string>();
    const insert = async (id: string | null, plain: string, stored = plain) => {
      expected.add(plain);
      await knex<Row>("concurrent").insert({
        ...(id ? { id } : {}),
        value: stored as never,
      });
    };

    await applySchema("test", null, schema);
    for (let index = 0; index < 12; index++) {
      await insert(null, `plain-${index}`);
    }
    expect(await status()).toMatchObject({ key: "k2", completed: false });

    // the first batch moves the cursor past five rows
    expect(await processSchemaEncrypt("test", "encrypted_concurrent")).toBe(
      true,
    );
    const { cursor } = (await status())!;
    expect(cursor).not.toBe(null);

    // meanwhile older pods keep writing plaintext and previous key values,
    // ids below the cursor are only seen by the sweep after the first pass
    const low = "00000000-0000-4000-8000-00000000000";
    const high = "ffffffff-ffff-4fff-bfff-ffffffffff0";
    await insert(`${low}1`, "late-plain-low");
    await insert(`${low}2`, "late-old-low", encryptOld("late-old-low"));
    await insert(`${high}1`, "late-plain-high");
    await insert(`${high}2`, "late-old-high", encryptOld("late-old-high"));

    let steps = 1;
    let addedBeforeCompleted = false;
    while (await processSchemaEncrypt("test", "encrypted_concurrent")) {
      steps++;
      const [constraint] = await constraintNames("concurrent");
      if (constraint && !(await status())!.completed) {
        addedBeforeCompleted = true;
      }
    }
    // 16 rows in batches of five, a cursor reset and the completing sweep
    expect(steps).toBeGreaterThanOrEqual(6);
    // the constraint is added in one step and validated in the next, so the
    // table is not locked while every row is read
    expect(addedBeforeCompleted).toBe(true);
    const [{ convalidated }] = await knex("pg_constraint")
      .select<{ convalidated: boolean }[]>("convalidated")
      .where("conname", "concurrent_encrypted_value");
    expect(convalidated).toBe(true);

    const rows = await knex<Row>("concurrent");
    expect(rows.length).toBe(16);
    expect(rows.every((row) => encryptedKeyId(row.value) === "k2")).toBe(true);
    expect(new Set(rows.map((row) => decrypt(row.value)))).toEqual(expected);
    expect(await status()).toMatchObject({
      key: "k2",
      cursor: null,
      completed: true,
    });
    expect(await constraintNames("concurrent")).toEqual([
      "concurrent_encrypted_value",
    ]);

    overrideEncryptionKeys("test", `dev:${DEV_KEY}`);
  });
});
