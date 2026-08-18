import { expect } from "jsr:@std/expect/expect";
import { describe, it } from "jsr:@std/testing/bdd";
import { UuidSchema } from "./schema.ts";
import { expectAsyncError } from "./test.ts";
import { createToken } from "./token.ts";
import { uuid, wait } from "./util.ts";

describe("jwt-token", () => {
  it("creats and validates token", async () => {
    const testToken = createToken("test", UuidSchema, 1000);

    const id = uuid();
    const token = await testToken.sign(id);
    expect(typeof token).toBe("string");

    const result = await testToken.verify(token);
    expect(result).toBe(id);

    const [issuer, payload, signature] = token.split(".");
    const badSignature = [issuer, payload, `${signature}invalid`].join(".");
    await expectAsyncError(
      () => testToken.verify(badSignature),
      /token is invalid \(signature\)/,
    );

    const badFormat = [issuer, payload].join(".");
    await expectAsyncError(
      () => testToken.verify(badFormat),
      /token is invalid \(malformed\)/,
    );

    await wait(2000);
    await expectAsyncError(
      () => testToken.verify(token),
      /token is invalid \(expired\)/,
    );
  });
});
