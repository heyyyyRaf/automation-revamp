/**
 * Usage: npm run user:create -- --email a@b.com --name "Ana" --role QA_TESTER
 * The password is read from the TRAXION_NEW_PASSWORD env var so it never lands in shell history.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { createUserSchema } from "../src/lib/validation";
import { db } from "../src/server/db";
import { createUser } from "../src/server/services/users";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: "QA_TESTER" },
    },
  });
  const parsed = createUserSchema.safeParse({
    ...values,
    password: process.env.TRAXION_NEW_PASSWORD,
  });
  if (!parsed.success) {
    console.error("Invalid input:", JSON.stringify(parsed.error.flatten().fieldErrors));
    console.error("Set TRAXION_NEW_PASSWORD (min 12 chars) and pass --email, --name, --role.");
    process.exitCode = 1;
    return;
  }
  const user = await createUser(parsed.data, null);
  console.log(`Created ${user.role} ${user.email}.`);
}

main()
  .catch((err: unknown) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
