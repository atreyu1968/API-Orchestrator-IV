import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const SESSION_COOKIE_NAME = "litagents_session";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

interface Session {
  token: string;
  expiresAt: number;
}

const activeSessions = new Map<string, Session>();

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function isRunningInReplit(): boolean {
  return !!(process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN);
}

function getConfiguredPassword(): string | null {
  return process.env.LITAGENTS_PASSWORD || null;
}

export function isAuthEnabled(): boolean {
  if (isRunningInReplit()) {
    return false;
  }
  return !!getConfiguredPassword();
}

export function validatePassword(password: string): boolean {
  const configuredPassword = getConfiguredPassword();
  if (!configuredPassword) return true;
  return password === configuredPassword;
}

export function createSession(): string {
  const token = generateSessionToken();
  const session: Session = {
    token,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };
  activeSessions.set(token, session);
  return token;
}

export function validateSession(token: string | undefined): boolean {
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string): void {
  activeSessions.delete(token);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    return next();
  }

  if (req.path === "/api/auth/login" || req.path === "/api/auth/status") {
    return next();
  }

  if (req.path.startsWith("/assets") || req.path.startsWith("/@") || req.path === "/favicon.ico") {
    return next();
  }

  const sessionToken = req.cookies?.[SESSION_COOKIE_NAME];
  
  if (validateSession(sessionToken)) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "Unauthorized", requiresAuth: true });
    return;
  }

  next();
}

export function setupAuthRoutes(app: any): void {
  app.get("/api/auth/status", (req: Request, res: Response) => {
    const authEnabled = isAuthEnabled();
    const sessionToken = req.cookies?.[SESSION_COOKIE_NAME];
    const isAuthenticated = authEnabled ? validateSession(sessionToken) : true;
    
    res.json({
      authEnabled,
      isAuthenticated,
      isReplit: isRunningInReplit(),
    });
  });

  app.post("/api/auth/login", (req: Request, res: Response) => {
    if (!isAuthEnabled()) {
      return res.json({ success: true, message: "Auth not required" });
    }

    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: "Password required" });
    }

    if (!validatePassword(password)) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const token = createSession();
    
    // Use SECURE_COOKIES env var to control secure flag (for HTTP deployments without HTTPS)
    const useSecureCookies = process.env.SECURE_COOKIES === "true";
    
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: useSecureCookies,
      sameSite: useSecureCookies ? "strict" : "lax",
      maxAge: SESSION_DURATION_MS,
    });

    res.json({ success: true });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const sessionToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (sessionToken) {
      destroySession(sessionToken);
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ success: true });
  });
}
