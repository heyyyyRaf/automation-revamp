import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __traxionPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  // Read directly (not via getEnv) so importing this module never throws during `next build`.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
  return new PrismaClient({ adapter });
}

/** Single Prisma client per process (survives Next dev hot reloads). All queries are parameterized. */
export const db: PrismaClient = globalThis.__traxionPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__traxionPrisma = db;
}
