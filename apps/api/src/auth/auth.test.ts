import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { sqlClient } from "../db/client";
import { env } from "../env";
import { app, cleanup, createWorkspace, ownerSql, PASSWORD, sessionCookie, signUp, uniqueEmail } from "../test/helpers";
import type { TestUser } from "../test/helpers";
import { JWT_AUDIENCE, JWT_ISSUER, SESSION_COOKIE, signSession } from "./session";

const secret = new TextEncoder().encode(env.JWT_SECRET);

function cookieFrom(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
}
const tokenFrom = (res: request.Response) => cookieFrom(res)?.split(";")[0]?.slice(SESSION_COOKIE.length + 1) ?? "";

const forge = (claims: Record<string, unknown>, opts: { exp?: number | string; key?: Uint8Array } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(opts.key ?? secret);

const me = (token: string) => request(app).get("/api/auth/me").set("Cookie", sessionCookie(token));

describe("auth", () => {
  let user: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    user = await signUp("auth");
    workspaceId = await createWorkspace(user, "Auth workspace");
  });
  afterAll(async () => {
    await cleanup();
    await Promise.all([ownerSql.end(), sqlClient.end()]);
  });

  describe("signup", () => {
    it("creates the user, hashes with argon2id and sets an httpOnly SameSite=Lax cookie", async () => {
      const email = uniqueEmail("signup");
      const res = await request(app).post("/api/auth/signup").send({ name: "New", email, password: PASSWORD }).expect(201);
      expect(res.body.user).toMatchObject({ email, name: "New" });
      expect(res.body.user.passwordHash).toBeUndefined();

      const cookie = cookieFrom(res) ?? "";
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);

      const [row] = await ownerSql<{ password_hash: string }[]>`select password_hash from users where email = ${email}`;
      expect(row?.password_hash).toMatch(/^\$argon2id\$/);
      expect(row?.password_hash).not.toContain(PASSWORD);
    });

    it("rejects a duplicate email regardless of case", async () => {
      await request(app)
        .post("/api/auth/signup")
        .send({ name: "Dup", email: user.email.toUpperCase(), password: PASSWORD })
        .expect(409);
    });

    it("rejects an invalid body", async () => {
      await request(app).post("/api/auth/signup").send({ name: "", email: "nope", password: "short" }).expect(400);
    });
  });

  describe("login", () => {
    it("logs in with valid credentials and selects the user's workspace", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);
      expect(res.body.workspace).toMatchObject({ id: workspaceId, role: "admin" });
      const meRes = await me(tokenFrom(res)).expect(200);
      expect(meRes.body.user.email).toBe(user.email);
      expect(meRes.body.workspace.id).toBe(workspaceId);
    });

    it("rejects a wrong password without setting a cookie", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: user.email, password: "wrong password" }).expect(401);
      expect(res.body.error).toBe("Invalid email or password");
      expect(cookieFrom(res)).toBeUndefined();
    });

    it("gives an unknown email the same response as a wrong password", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: uniqueEmail("ghost"), password: PASSWORD }).expect(401);
      expect(res.body.error).toBe("Invalid email or password");
      expect(cookieFrom(res)).toBeUndefined();
    });

    it("rate limits repeated attempts", async () => {
      const limited = createApp({ authRateLimit: 2 });
      const body = { email: user.email, password: "wrong password" };
      await request(limited).post("/api/auth/login").send(body).expect(401);
      await request(limited).post("/api/auth/login").send(body).expect(401);
      await request(limited).post("/api/auth/login").send(body).expect(429);
    });
  });

  describe("tokens", () => {
    let validToken: string;
    beforeAll(async () => {
      const res = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);
      validToken = tokenFrom(res);
    });

    it("rejects requests without a cookie", async () => {
      await request(app).get("/api/auth/me").expect(401);
    });

    it("rejects garbage", async () => {
      await me("not-a-jwt").expect(401);
    });

    it("rejects a tampered payload", async () => {
      const [header, , signature] = validToken.split(".");
      const other = await signUp("victim");
      const payload = Buffer.from(JSON.stringify({ sub: other.id, wid: workspaceId, sv: 0, iss: JWT_ISSUER, aud: JWT_AUDIENCE, exp: 9999999999, iat: 1 })).toString("base64url");
      await me(`${header}.${payload}.${signature}`).expect(401);
    });

    it("rejects a tampered signature", async () => {
      // Flip a char in the middle of the signature (the last char carries padding bits).
      const i = validToken.length - 10;
      const flipped = validToken[i] === "A" ? "B" : "A";
      await me(validToken.slice(0, i) + flipped + validToken.slice(i + 1)).expect(401);
    });

    it("rejects a token signed with another secret", async () => {
      const token = await forge({ sub: user.id, wid: workspaceId, sv: 0 }, { key: new TextEncoder().encode("x".repeat(48)) });
      await me(token).expect(401);
    });

    it("rejects alg=none", async () => {
      const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const token = `${enc({ alg: "none", typ: "JWT" })}.${enc({ sub: user.id, wid: workspaceId, sv: 0, iss: JWT_ISSUER, aud: JWT_AUDIENCE, exp: 9999999999 })}.`;
      await me(token).expect(401);
    });

    it("rejects an expired token", async () => {
      const token = await forge({ sub: user.id, wid: workspaceId, sv: 0 }, { exp: Math.floor(Date.now() / 1000) - 60 });
      await me(token).expect(401);
    });

    it("accepts a correctly signed, unexpired token (control)", async () => {
      await me(await signSession({ userId: user.id, workspaceId, sessionVersion: 0 })).expect(200);
    });
  });

  describe("logout", () => {
    it("clears the cookie and revokes the token even if it is replayed", async () => {
      const u = await signUp("logout");
      const res = await request(app).post("/api/auth/login").send({ email: u.email, password: PASSWORD }).expect(200);
      const token = tokenFrom(res);
      await me(token).expect(200);

      const out = await request(app).post("/api/auth/logout").set("Cookie", sessionCookie(token)).expect(204);
      expect(cookieFrom(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
      await me(token).expect(401);

      // Logging in again issues a new, working session.
      const again = await request(app).post("/api/auth/login").send({ email: u.email, password: PASSWORD }).expect(200);
      await me(tokenFrom(again)).expect(200);
    });
  });

  describe("CSRF", () => {
    it("rejects writes from a foreign Origin", async () => {
      await request(app)
        .post("/api/auth/login")
        .set("Origin", "https://evil.example")
        .send({ email: user.email, password: PASSWORD })
        .expect(403);
    });

    it("allows writes from the web origin", async () => {
      await request(app)
        .post("/api/auth/login")
        .set("Origin", env.WEB_ORIGIN)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
    });
  });
});
