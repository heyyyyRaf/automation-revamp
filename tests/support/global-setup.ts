import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import pg from "pg";

/**
 * Integration tests run against TEST_DATABASE_URL (never DATABASE_URL), which is wiped and
 * migrated from scratch so the real migrations are exercised every run.
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start Postgres (docker compose up -d postgres) and set it in .env.",
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL — tests wipe the database.");
  }

  await ensureDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();

  const root = fileURLToPath(new URL("../..", import.meta.url));
  execFileSync(
    process.execPath,
    [`${root}node_modules/prisma/build/index.js`, "migrate", "deploy"],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    },
  );
}

async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!/^[a-z0-9_]+$/i.test(dbName)) throw new Error("Unexpected test database name.");
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();
}
