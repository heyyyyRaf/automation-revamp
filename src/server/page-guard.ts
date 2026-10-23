import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";

/** In server components, turn "not found / no access" into the standard 404 page. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}
