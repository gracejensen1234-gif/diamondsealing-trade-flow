import { Router } from "express";
import {
  authenticateByEmailPassword,
  authSetupStatus,
  clearSessionCookie,
  ensureEnvUsers,
  requireAuth,
  setSessionCookie,
} from "../lib/auth.js";

const router = Router();

router.get("/auth/setup-status", async (_req, res) => {
  try {
    await ensureEnvUsers();
  } catch {
    return res.json(authSetupStatus());
  }

  return res.json(authSetupStatus());
});

router.post("/auth/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!authSetupStatus().configured) {
    return res.status(503).json({
      error: "Login is not configured yet",
      setup: authSetupStatus(),
    });
  }

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await authenticateByEmailPassword(email, password);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  setSessionCookie(res, user);
  return res.json({ user });
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  return res.status(204).send();
});

router.get("/auth/me", requireAuth, (req, res) => {
  return res.json({ user: req.authUser });
});

export default router;
