import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pg from "pg";

const { Pool } = pg;

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : undefined
});

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server / curl requests without an Origin header.
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS."));
    },
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-RSVP-Token"],
    maxAge: 86400
  })
);

app.use(express.json({ limit: "16kb" }));

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many RSVP attempts. Please try again later."
  }
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function validateRsvp(body) {
  const guestName = cleanText(body?.guestName, 120);
  const attendance = body?.attendance;
  const message = cleanText(body?.message, 600);
  const companionNames = cleanText(body?.companionNames, 240);

  if (guestName.length < 2) {
    return { error: "Please enter a valid guest name." };
  }

  if (!["attending", "declined"].includes(attendance)) {
    return { error: "Attendance must be either attending or declined." };
  }

  let partySize = Number.parseInt(body?.partySize, 10);

  if (attendance === "declined") {
    partySize = 1;
  }

  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) {
    return { error: "Party size must be between 1 and 10." };
  }

  return {
    value: {
      guestName,
      attendance,
      partySize,
      companionNames: attendance === "attending" ? companionNames : "",
      message
    }
  };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqualHex(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    a.length !== b.length
  ) {
    return false;
  }

  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");

  if (aBuffer.length !== bBuffer.length) return false;

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function getEditToken(req) {
  const token = req.get("X-RSVP-Token");
  return typeof token === "string" ? token.trim() : "";
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rsvps (
      id UUID PRIMARY KEY,
      edit_token_hash TEXT NOT NULL,
      guest_name VARCHAR(120) NOT NULL,
      attendance VARCHAR(16) NOT NULL
        CHECK (attendance IN ('attending', 'declined')),
      party_size INTEGER NOT NULL DEFAULT 1
        CHECK (party_size BETWEEN 1 AND 10),
      companion_names VARCHAR(240) NOT NULL DEFAULT '',
      message VARCHAR(600) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_rsvps_attendance
      ON rsvps (attendance);
  `);
}

app.get("/health", readLimiter, async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(503).json({ ok: false });
  }
});

app.get("/api/rsvps/stats", readLimiter, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS responses,
        COUNT(*) FILTER (WHERE attendance = 'attending')::int AS attending_responses,
        COALESCE(
          SUM(party_size) FILTER (WHERE attendance = 'attending'),
          0
        )::int AS attending_people,
        COUNT(*) FILTER (WHERE attendance = 'declined')::int AS declined_responses
      FROM rsvps;
    `);

    const row = result.rows[0];

    res.set("Cache-Control", "public, max-age=20, stale-while-revalidate=40");

    res.json({
      responses: row.responses,
      attendingResponses: row.attending_responses,
      attendingPeople: row.attending_people,
      declinedResponses: row.declined_responses
    });
  } catch (error) {
    console.error("Stats query failed:", error);
    res.status(500).json({ error: "Unable to load RSVP statistics." });
  }
});

app.post("/api/rsvps", writeLimiter, async (req, res) => {
  const validation = validateRsvp(req.body);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const id = crypto.randomUUID();
  const editToken = crypto.randomBytes(32).toString("hex");
  const editTokenHash = hashToken(editToken);
  const {
    guestName,
    attendance,
    partySize,
    companionNames,
    message
  } = validation.value;

  try {
    await pool.query(
      `
        INSERT INTO rsvps (
          id,
          edit_token_hash,
          guest_name,
          attendance,
          party_size,
          companion_names,
          message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        id,
        editTokenHash,
        guestName,
        attendance,
        partySize,
        companionNames,
        message
      ]
    );

    res.status(201).json({
      id,
      editToken
    });
  } catch (error) {
    console.error("RSVP insert failed:", error);
    res.status(500).json({ error: "Unable to save the RSVP." });
  }
});

app.get("/api/rsvps/:id", readLimiter, async (req, res) => {
  const editToken = getEditToken(req);

  if (!editToken) {
    return res.status(401).json({ error: "RSVP edit token is required." });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          id,
          edit_token_hash,
          guest_name,
          attendance,
          party_size,
          companion_names,
          message,
          created_at,
          updated_at
        FROM rsvps
        WHERE id = $1
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "RSVP not found." });
    }

    const row = result.rows[0];
    const incomingHash = hashToken(editToken);

    if (!safeEqualHex(row.edit_token_hash, incomingHash)) {
      return res.status(403).json({ error: "Invalid RSVP edit token." });
    }

    res.set("Cache-Control", "no-store");

    res.json({
      id: row.id,
      guestName: row.guest_name,
      attendance: row.attendance,
      partySize: row.party_size,
      companionNames: row.companion_names,
      message: row.message,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    console.error("RSVP lookup failed:", error);

    if (error?.code === "22P02") {
      return res.status(404).json({ error: "RSVP not found." });
    }

    res.status(500).json({ error: "Unable to load the RSVP." });
  }
});

app.put("/api/rsvps/:id", writeLimiter, async (req, res) => {
  const editToken = getEditToken(req);

  if (!editToken) {
    return res.status(401).json({ error: "RSVP edit token is required." });
  }

  const validation = validateRsvp(req.body);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const existing = await pool.query(
      `
        SELECT edit_token_hash
        FROM rsvps
        WHERE id = $1
      `,
      [req.params.id]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({ error: "RSVP not found." });
    }

    const incomingHash = hashToken(editToken);

    if (!safeEqualHex(existing.rows[0].edit_token_hash, incomingHash)) {
      return res.status(403).json({ error: "Invalid RSVP edit token." });
    }

    const {
      guestName,
      attendance,
      partySize,
      companionNames,
      message
    } = validation.value;

    await pool.query(
      `
        UPDATE rsvps
        SET
          guest_name = $2,
          attendance = $3,
          party_size = $4,
          companion_names = $5,
          message = $6,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        req.params.id,
        guestName,
        attendance,
        partySize,
        companionNames,
        message
      ]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("RSVP update failed:", error);

    if (error?.code === "22P02") {
      return res.status(404).json({ error: "RSVP not found." });
    }

    res.status(500).json({ error: "Unable to update the RSVP." });
  }
});

app.use((error, _req, res, _next) => {
  if (error?.message === "Origin not allowed by CORS.") {
    return res.status(403).json({ error: "Origin not allowed." });
  }

  console.error("Unhandled request error:", error);
  return res.status(500).json({ error: "Unexpected server error." });
});

ensureSchema()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Multi-Celebration RSVP API listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });

async function shutdown(signal) {
  console.log(`${signal} received. Closing database pool.`);
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
