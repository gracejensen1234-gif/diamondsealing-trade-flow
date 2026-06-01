import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { attachAuthUser } from "./lib/auth.js";

const app: Express = express();

app.disable("x-powered-by");
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (!origin || process.env.NODE_ENV !== "production" || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(attachAuthUser);

app.use("/api", router);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : path.resolve(currentDir, "../../tradify/dist/public");

if (process.env.NODE_ENV === "production" && existsSync(publicDir)) {
  app.use(express.static(publicDir));

  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      return next();
    }

    return res.sendFile(path.join(publicDir, "index.html"));
  });
}

export default app;
