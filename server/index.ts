import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { queueManager } from "./queue-manager";
import { autoResumeReeditProjects, startWatchdog } from "./reedit-auto-resume";
import { autoResumeTranslations, startTranslationWatchdog } from "./translation-auto-resume";
import { cleanupZombieRuns } from "./orchestrators/auto-corrector";

// Production diagnostics: Log process signals and memory usage
process.on("SIGTERM", () => {
  console.log("[PROCESS] Received SIGTERM signal - server shutting down");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[PROCESS] Received SIGINT signal - server shutting down");
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("[PROCESS] Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[PROCESS] Unhandled Rejection at:", promise, "reason:", reason);
});

// Log memory usage periodically in production
if (process.env.NODE_ENV === "production") {
  setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(usage.rss / 1024 / 1024);
    if (heapUsedMB > 400) { // Log if using more than 400MB heap
      console.log(`[MEMORY] Heap: ${heapUsedMB}MB/${heapTotalMB}MB, RSS: ${rssMB}MB`);
    }
  }, 60000); // Every minute
}

const app = express();

// Trust proxy for Cloudflare Tunnel and other reverse proxies
// This allows Express to correctly read X-Forwarded-* headers
app.set('trust proxy', 1);

const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: '50mb' }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);
      
      // Initialize queue manager to restore state from previous session
      try {
        await queueManager.initialize();
        log("Queue manager initialized", "queue");
      } catch (error) {
        log(`Queue manager initialization error: ${error}`, "queue");
      }
      
      // Cleanup zombie auto-correction runs from previous server session
      try {
        const zombiesCleaned = await cleanupZombieRuns();
        if (zombiesCleaned > 0) {
          log(`Auto-corrector: cleaned ${zombiesCleaned} zombie run(s)`, "auto-corrector");
        }
      } catch (error) {
        log(`Auto-corrector zombie cleanup error: ${error}`, "auto-corrector");
      }

      // Auto-resume reedit projects and translations that were in processing state
      try {
        setTimeout(async () => {
          log("Checking for reedit projects to auto-resume...", "reedit");
          await autoResumeReeditProjects();
          startWatchdog();
          log("Reedit watchdog started", "reedit");
          
          log("Checking for translations to auto-resume...", "translation");
          await autoResumeTranslations();
          startTranslationWatchdog();
          log("Translation watchdog started", "translation");
        }, 3000);
      } catch (error) {
        log(`Auto-resume error: ${error}`, "system");
      }
    },
  );
})();
