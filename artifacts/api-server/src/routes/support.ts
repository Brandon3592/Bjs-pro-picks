import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, usersTable, helpSubmissionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

// ─── Admin guard ──────────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || req.user.id !== adminId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// ─── Help submission (any authenticated user) ─────────────────────────────────

router.post("/support/help", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Please log in to submit a help request" });
    return;
  }

  const { name, email, subject, message } = req.body as Record<string, unknown>;
  if (
    typeof name !== "string" || !name.trim() ||
    typeof email !== "string" || !email.trim() ||
    typeof subject !== "string" || !subject.trim() ||
    typeof message !== "string" || !message.trim()
  ) {
    res.status(400).json({ error: "name, email, subject, and message are required" });
    return;
  }

  const [row] = await db.insert(helpSubmissionsTable).values({
    userId: req.user.id,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    subject: subject.trim(),
    message: message.trim(),
  }).returning();

  req.log.info({ id: row.id, userId: req.user.id }, "Help submission created");
  res.status(201).json({ success: true, id: row.id });
});

router.get("/support/help/mine", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await db
    .select()
    .from(helpSubmissionsTable)
    .where(eq(helpSubmissionsTable.userId, req.user.id))
    .orderBy(desc(helpSubmissionsTable.createdAt));
  res.json(rows);
});

// ─── Admin: list all users ────────────────────────────────────────────────────

router.get("/admin/users", requireAdmin, async (req: Request, res: Response) => {
  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));
  res.json(users);
});

// ─── Admin: list + manage help submissions ────────────────────────────────────

router.get("/admin/submissions", requireAdmin, async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(helpSubmissionsTable)
    .orderBy(desc(helpSubmissionsTable.createdAt));
  res.json(rows);
});

router.patch("/admin/submissions/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { status, adminReply } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof status === "string" && ["new", "read", "replied"].includes(status)) {
    updates.status = status;
  }
  if (typeof adminReply === "string") {
    updates.adminReply = adminReply.trim();
    updates.repliedAt = new Date();
    updates.status = "replied";
  }

  const [updated] = await db
    .update(helpSubmissionsTable)
    .set(updates)
    .where(eq(helpSubmissionsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  res.json(updated);
});

export default router;
