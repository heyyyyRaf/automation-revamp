import { extname } from "node:path";

/**
 * Display-only file name: strips any path, control/bidi characters and reserved characters.
 * Never used to build a storage path (storage keys are random).
 */
export function sanitizeDisplayName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    // C0/C1 controls and Unicode bidi overrides (used to disguise extensions).
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  if (cleaned.length <= 200) return cleaned || "file";
  const ext = extname(cleaned).slice(0, 16);
  return cleaned.slice(0, 200 - ext.length) + ext;
}

export function lowerExtension(name: string): string {
  return extname(name).toLowerCase();
}
