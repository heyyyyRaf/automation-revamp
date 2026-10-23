import { json, route } from "@/server/http/handler";

export const GET = route(async ({ auth }) => json({ user: auth.user }));
