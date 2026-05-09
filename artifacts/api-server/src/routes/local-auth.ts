import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, credentialsTable, rememberMeTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  createSession,
  deleteSession,
  getSessionId,
  SESSION_COOKIE,
  type SessionData,
} from "../lib/auth";

const router: IRouter = Router();

const REMEMBER_ME_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_SHORT_TTL = 24 * 60 * 60 * 1000; // 1 day (no remember me)
const REMEMBER_ME_COOKIE = "rm_token";
const SALT_ROUNDS = 12;

function setSessionCookie(res: Response, sid: string, rememberMe: boolean) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: rememberMe ? REMEMBER_ME_TTL : SESSION_SHORT_TTL,
  });
}

function setRememberMeCookie(res: Response, token: string) {
  res.cookie(REMEMBER_ME_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: REMEMBER_ME_TTL,
  });
}

function parseBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object") return body as Record<string, unknown>;
  return {};
}

// POST /api/auth/register
router.post("/auth/register", async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = parseBody(req.body);

  if (typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const normalEmail = email.toLowerCase().trim();

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalEmail));
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const userId = crypto.randomUUID();

  const fName = typeof firstName === "string" ? firstName.trim() || null : null;
  const lName = typeof lastName === "string" ? lastName.trim() || null : null;

  const [user] = await db.insert(usersTable).values({
    id: userId,
    email: normalEmail,
    firstName: fName,
    lastName: lName,
  }).returning();

  await db.insert(credentialsTable).values({ userId: user.id, passwordHash });

  const sessionData: SessionData = {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
    access_token: "local",
  };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid, false);

  res.status(201).json({ success: true });
});

// POST /api/auth/login
router.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password, rememberMe } = parseBody(req.body);

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  const normalEmail = email.toLowerCase().trim();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalEmail));
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const [cred] = await db.select().from(credentialsTable).where(eq(credentialsTable.userId, user.id));
  if (!cred) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, cred.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const doRemember = rememberMe === true || rememberMe === "true";

  const sessionData: SessionData = {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: user.profileImageUrl },
    access_token: "local",
  };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid, doRemember);

  // Issue a long-lived remember-me token
  if (doRemember) {
    const rmToken = crypto.randomBytes(32).toString("hex");
    await db.insert(rememberMeTable).values({
      token: rmToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + REMEMBER_ME_TTL),
    });
    setRememberMeCookie(res, rmToken);
  }

  res.json({ success: true });
});

// POST /api/auth/logout
router.post("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(REMEMBER_ME_COOKIE, { path: "/" });
  res.json({ success: true });
});

// GET /api/auth/logout (for backward compat with web redirects)
router.get("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(REMEMBER_ME_COOKIE, { path: "/" });
  res.redirect("/");
});

// POST /api/auth/mobile-login  — returns session token for mobile bearer auth
router.post("/auth/mobile-login", async (req: Request, res: Response) => {
  const { email, password } = parseBody(req.body);

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  const normalEmail = email.toLowerCase().trim();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalEmail));
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const [cred] = await db.select().from(credentialsTable).where(eq(credentialsTable.userId, user.id));
  if (!cred) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, cred.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const sessionData: SessionData = {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: user.profileImageUrl },
    access_token: "local",
  };
  const sid = await createSession(sessionData);
  res.json({ token: sid, userId: user.id, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email });
});

// POST /api/auth/mobile-register
router.post("/auth/mobile-register", async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = parseBody(req.body);

  if (typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const normalEmail = email.toLowerCase().trim();
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalEmail));
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const userId = crypto.randomUUID();

  const fName = typeof firstName === "string" ? firstName.trim() || null : null;
  const lName = typeof lastName === "string" ? lastName.trim() || null : null;

  const [user] = await db.insert(usersTable).values({ id: userId, email: normalEmail, firstName: fName, lastName: lName }).returning();
  await db.insert(credentialsTable).values({ userId: user.id, passwordHash });

  const sessionData: SessionData = {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
    access_token: "local",
  };
  const sid = await createSession(sessionData);
  res.status(201).json({ token: sid, userId: user.id, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email });
});

// POST /api/auth/mobile-logout
router.post("/auth/mobile-logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) await deleteSession(sid);
  res.json({ success: true });
});

export default router;
