import { join } from "node:path";
import ts from "typescript";

/** Types of the harness module scripts import (`./traxion`); mirrors runner/traxion.tpl. */
export const HARNESS_TYPES = `import type {
  Expect,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "@playwright/test";
export declare const test: TestType<PlaywrightTestArgs & PlaywrightTestOptions, PlaywrightWorkerArgs & PlaywrightWorkerOptions>;
export declare const expect: Expect<{}>;
export declare function account(label: string): { username: string; password: string };
export declare const vars: Readonly<Record<string, string>>;
`;

export interface Diagnostic {
  line: number;
  message: string;
}

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  types: [],
  skipLibCheck: true,
  esModuleInterop: true,
};

/**
 * Type-checks one script in memory against the real @playwright/test types and the harness
 * types. Virtual files live under the app directory so `node_modules` resolves normally.
 */
export function typeCheckScript(code: string): { ok: boolean; diagnostics: Diagnostic[] } {
  const dir = join(process.cwd(), "__tqa_typecheck__", "tests");
  const scriptPath = join(dir, "script.spec.ts").replace(/\\/g, "/");
  const harnessPath = join(dir, "traxion.d.ts").replace(/\\/g, "/");

  // TypeScript lower-cases paths on case-insensitive file systems (Windows), so compare
  // normalized paths. Module resolution also checks that the (virtual) directory exists.
  const caseSensitive = ts.sys.useCaseSensitiveFileNames;
  const norm = (f: string) => {
    const p = f.replace(/\\/g, "/");
    return caseSensitive ? p : p.toLowerCase();
  };
  const virtual = new Map([
    [norm(scriptPath), code],
    [norm(harnessPath), HARNESS_TYPES],
  ]);
  const virtualDir = norm(dir);

  const host = ts.createCompilerHost(OPTIONS, true);
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => {
    const n = norm(d);
    return virtualDir === n || virtualDir.startsWith(`${n}/`) || (directoryExists?.(d) ?? false);
  };
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const text = virtual.get(norm(fileName));
    if (text !== undefined) return ts.createSourceFile(fileName, text, languageVersion, true);
    return getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (f) => virtual.has(norm(f)) || fileExists(f);
  const readFile = host.readFile.bind(host);
  host.readFile = (f) => virtual.get(norm(f)) ?? readFile(f);

  const program = ts.createProgram([scriptPath], OPTIONS, host);
  const source = program.getSourceFile(scriptPath);
  const all = [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ];
  const diagnostics = all.slice(0, 50).map((d) => {
    const line =
      d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 1;
    return { line, message: ts.flattenDiagnosticMessageText(d.messageText, "\n").slice(0, 500) };
  });
  return { ok: diagnostics.length === 0, diagnostics };
}
