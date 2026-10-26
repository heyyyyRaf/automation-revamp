import type { Prisma } from "@/generated/prisma/client";
import type { DomSnapshotData } from "@/server/sandbox/protocol";
import { selectorCheck, type SelectorResult } from "@/server/scripts/selector-check";
import { staticSafetyCheck, type SafetyIssue } from "@/server/scripts/static-check";
import { typeCheckScript, type Diagnostic } from "@/server/scripts/typecheck";

export const MAX_SCRIPT_CHARS = 100_000;

export interface ScriptChecks {
  typeCheckOk: boolean;
  typeCheckLog: Diagnostic[];
  safetyCheckOk: boolean;
  safetyIssues: SafetyIssue[];
  selectorCheck: SelectorResult[];
}

/** Runs every check on a script. A version can only be approved if type + safety checks pass. */
export function checkScript(code: string, dom: DomSnapshotData | null): ScriptChecks {
  if (code.length > MAX_SCRIPT_CHARS) {
    const issue = { line: 1, message: `Scripts are limited to ${MAX_SCRIPT_CHARS} characters.` };
    return {
      typeCheckOk: false,
      typeCheckLog: [issue],
      safetyCheckOk: false,
      safetyIssues: [issue],
      selectorCheck: [],
    };
  }
  const safety = staticSafetyCheck(code);
  const types = typeCheckScript(code);
  return {
    typeCheckOk: types.ok,
    typeCheckLog: types.diagnostics,
    safetyCheckOk: safety.ok,
    safetyIssues: safety.issues,
    selectorCheck: selectorCheck(code, dom),
  };
}

export function checksToColumns(c: ScriptChecks) {
  return {
    typeCheckOk: c.typeCheckOk,
    typeCheckLog: c.typeCheckLog as unknown as Prisma.InputJsonValue,
    safetyCheckOk: c.safetyCheckOk,
    safetyIssues: c.safetyIssues as unknown as Prisma.InputJsonValue,
    selectorCheck: c.selectorCheck as unknown as Prisma.InputJsonValue,
  };
}
