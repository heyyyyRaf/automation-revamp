/**
 * Read-only script view from the design: dark panel, line numbers, light syntax colours.
 * Rendered as text nodes only (React escapes everything) — the code is never run here.
 */
const KEYWORDS =
  /^(import|from|async|await|const|let|return|if|else|for|of|new|true|false|null|test|expect)$/;
const METHODS =
  /^(goto|getByLabel|getByRole|getByText|getByTestId|getByPlaceholder|locator|fill|click|press|check|selectOption|step|toBeVisible|toHaveURL|toHaveText|toBeDisabled|toBeEnabled|toHaveValue|toHaveCount|toContainText|account)$/;

const COLORS = {
  text: "text-[#E6E9F2]",
  string: "text-[#9FE0B0]",
  regex: "text-[#F5B37A]",
  keyword: "text-[#C4A7FF]",
  method: "text-[#8CC8FF]",
  comment: "text-[#8A93AB]",
} as const;

type Token = { t: string; c: keyof typeof COLORS };

function tokenize(line: string): Token[] {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//")) return [{ t: line, c: "comment" }];
  const out: Token[] = [];
  const re =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*$|\/(?![/*\s])(?:[^/\\\n]|\\.)+\/[gimsuy]*|\b[A-Za-z_]\w*\b|[^"'`A-Za-z_/]+|\/)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const t = m[0];
    let c: Token["c"] = "text";
    if (t.startsWith("//")) c = "comment";
    else if (t[0] === '"' || t[0] === "'" || t[0] === "`") c = "string";
    else if (t[0] === "/" && t.length > 1) c = "regex";
    else if (KEYWORDS.test(t)) c = "keyword";
    else if (METHODS.test(t)) c = "method";
    out.push({ t, c });
  }
  return out.length ? out : [{ t: " ", c: "text" }];
}

export function CodeView({ code, flagged }: { code: string; flagged: Set<number> }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className="relative overflow-x-auto py-3.5 font-mono text-[13px] leading-[1.75]">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`flex whitespace-pre ${flagged.has(i + 1) ? "bg-[rgba(245,179,122,0.14)]" : ""}`}
        >
          <span
            className="w-12 shrink-0 pr-4 text-right text-[#8A93AB] select-none"
            aria-hidden="true"
          >
            {i + 1}
          </span>
          <span>
            {tokenize(line).map((tk, j) => (
              <span key={j} className={COLORS[tk.c]}>
                {tk.t}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
