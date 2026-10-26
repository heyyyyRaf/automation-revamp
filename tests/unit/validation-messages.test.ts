import { describe, expect, it } from "vitest";
import { z } from "zod";
import { aiBudgetSchema, changePasswordSchema, newPasswordSchema } from "@/lib/validation";

const first = (r: { success: boolean; error?: z.ZodError }) => r.error?.issues[0]?.message;

describe("validation messages", () => {
  it("are plain language where a rule has no message of its own", () => {
    expect(first(aiBudgetSchema.safeParse({ monthlyTokenCap: 5 }))).toBe("Use 1,000 or more.");
    expect(first(aiBudgetSchema.safeParse({ monthlyTokenCap: 2_000_000_000 }))).toBe(
      "Use 1,000,000,000 or less.",
    );
    expect(first(aiBudgetSchema.safeParse({}))).toBe("This is required.");
    expect(first(z.object({ a: z.string().max(3) }).safeParse({ a: "abcd" }))).toBe(
      "Use at most 3 characters.",
    );
    expect(first(z.enum(["A", "B"]).safeParse("C"))).toBe("Choose one of the options.");
  });

  it("keep a rule's own message", () => {
    expect(first(newPasswordSchema.safeParse("abcdefg1!"))).toBe(
      "Add at least one capital letter.",
    );
    expect(
      first(changePasswordSchema.safeParse({ currentPassword: "", newPassword: "Abcdefg1!" })),
    ).toBe("Enter your current password.");
  });
});
