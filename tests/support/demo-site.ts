/** A tiny web app used as the "target application" in sandbox and run tests. */
import http from "node:http";
import type { AddressInfo } from "node:net";

export const DEMO_USER = { username: "ana@demo.test", password: "S3cret-Passw0rd!" };

const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

export interface DemoSite {
  origin: string;
  /** Number of requests received — used to prove blocked traffic never arrived. */
  requests: () => number;
  close: () => Promise<void>;
}

export async function startDemoSite(): Promise<DemoSite> {
  let count = 0;
  const server = http.createServer((req, res) => {
    count++;
    const url = new URL(req.url ?? "/", "http://x");
    const cookie = req.headers.cookie ?? "";
    const html = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(body);
    };

    if (url.pathname === "/") {
      return html(
        200,
        page(
          "Demo Shop",
          `<h1>Demo Shop</h1><a href="/cart">Cart</a> <a href="/login">Sign in</a>`,
        ),
      );
    }
    if (url.pathname === "/login" && req.method === "GET") {
      return html(
        200,
        page(
          "Sign in",
          `<h1>Sign in</h1><form method="post" action="/login">
             <label for="email">Email</label><input id="email" name="email" type="email">
             <label for="password">Password</label><input id="password" name="password" type="password">
             <button type="submit">Sign in</button></form>`,
        ),
      );
    }
    if (url.pathname === "/login" && req.method === "POST") {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        if (
          form.get("email") === DEMO_USER.username &&
          form.get("password") === DEMO_USER.password
        ) {
          html(302, "", { location: "/account", "set-cookie": "session=ok; Path=/; HttpOnly" });
        } else {
          html(
            401,
            page("Sign in", `<h1>Sign in</h1><p role="alert">Invalid email or password</p>`),
          );
        }
      });
      return;
    }
    if (url.pathname === "/account") {
      if (!cookie.includes("session=ok")) return html(302, "", { location: "/login" });
      return html(200, page("Account", `<h1>Welcome back</h1>`));
    }
    if (url.pathname === "/api/items") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: [] }));
      return;
    }
    if (url.pathname === "/cart") {
      return html(
        200,
        page(
          "Cart",
          `<h1>Your cart</h1><p id="count">Items: 0</p>
           <button data-testid="add-item" onclick="document.getElementById('count').textContent='Items: '+(++window.n||(window.n=1))">Add to cart</button>
           <script>window.n=0;console.log("cart ready");fetch("/api/items?token=QUERY-SECRET-123")</script>`,
        ),
      );
    }
    if (url.pathname === "/slow") {
      setTimeout(() => html(200, page("Slow", `<h1>Slow page</h1>`)), 1500);
      return;
    }
    html(404, page("Not found", "<h1>Not found</h1>"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests: () => count,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
