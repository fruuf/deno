import { jwtVerify, SignJWT } from "npm:jose";
import { JWSSignatureVerificationFailed, JWTExpired } from "npm:jose/errors";
import { getSiteSecret } from "./config.ts";
import { SafeError } from "./error.ts";
import { SchemaType, StaticSchema } from "./schema.ts";

const encoder = new TextEncoder();

type TokenErrorType = "expired" | "issuer" | "signature" | "malformed";

export class TokenError extends SafeError {
  type: TokenErrorType;
  constructor(type: TokenErrorType) {
    super("tokenError", `token is invalid (${type})`);
    this.type = type;
  }
}

export function createToken<Schema extends SchemaType>(
  issuer: string,
  schema: Schema,
  expiresIn = 1000 * 60 * 60,
) {
  return {
    async sign(data: StaticSchema<Schema>) {
      const payload = schema.parse(data);
      const secret = encoder.encode(getSiteSecret());

      const token = await new SignJWT({ data: payload })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(new Date(Date.now() + expiresIn))
        .setIssuer(issuer)
        .sign(secret);

      return token;
    },
    async verify(token: string) {
      const secret = encoder.encode(getSiteSecret());
      try {
        const { payload: { data, iss } } = await jwtVerify(token, secret);

        if (iss !== issuer) {
          throw new TokenError("issuer");
        }
        return schema.parse(data);
      } catch (error) {
        if (error instanceof JWTExpired) {
          throw new TokenError("expired");
        }
        if (error instanceof JWSSignatureVerificationFailed) {
          throw new TokenError("signature");
        }
        throw new TokenError("malformed");
      }
    },
  };
}
