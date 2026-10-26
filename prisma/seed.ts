/**
 * Creates the first Admin from SEED_ADMIN_* env vars. Idempotent: does nothing if the email exists.
 * There are no default credentials — the command fails if the variables are missing.
 */
import "dotenv/config";
import { createUserSchema } from "../src/lib/validation";
import { db } from "../src/server/db";
import { createUser } from "../src/server/services/users";

async function main(): Promise<void> {
  const input = createUserSchema.safeParse({
    email: process.env.SEED_ADMIN_EMAIL,
    name: process.env.SEED_ADMIN_NAME ?? "Admin",
    role: "ADMIN",
    password: process.env.SEED_ADMIN_PASSWORD,
  });
  if (!input.success) {
    console.error(
      "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (8+ characters with a capital letter, a number and a special character) in .env, then run again.",
    );
    process.exitCode = 1;
    return;
  }
  const existing = await db.user.findUnique({ where: { email: input.data.email } });
  if (existing) {
    console.log(`Admin ${input.data.email} already exists — nothing to do.`);
    return;
  }
  await createUser(input.data, null);
  console.log(`Created admin ${input.data.email}.`);
}

main()
  .catch((err: unknown) => {
    console.error("Seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
