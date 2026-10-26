import { z } from "zod";
import { encryptBuffer } from "@/server/crypto/secrets";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { runInSandbox } from "@/server/sandbox/sandbox";
import { grantedOrigins, loadEnvironmentSecrets } from "@/server/services/environments";
import { getStorage, newObjectKey } from "@/server/storage/storage";

const payloadSchema = z.object({ environmentId: z.string().min(1) });

/**
 * FRD step 5: "system tests the login once and saves the session state". With sign-in
 * settings it signs in with the default account; otherwise it checks the start page opens.
 * Failure leaves the environment "Unverified" (verifiedAt = null), which blocks runs.
 */
export const verifyEnvironmentHandler: JobHandler = async ({ job, signal }) => {
  const payload = payloadSchema.safeParse(job.payload);
  if (!payload.success) throw new JobFailure("This job has invalid settings.", false);
  const env = await db.environment.findFirst({
    where: {
      id: payload.data.environmentId,
      OR: [{ projectId: job.projectId }, { projectId: null }],
    },
  });
  if (!env) throw new JobFailure("This environment no longer exists.", false);

  const secrets = await loadEnvironmentSecrets(env);
  const login = secrets.loginConfig;
  const fail = async (message: string): Promise<never> => {
    await db.environment.update({
      where: { id: env.id },
      data: {
        verifiedAt: null,
        loginCheckStatus: login ? "FAILED" : "NOT_CHECKED",
        loginCheckedAt: new Date(),
        loginCheckError: message,
      },
    });
    throw new JobFailure(message, false);
  };

  let origins;
  try {
    origins = await grantedOrigins(env);
  } catch (err) {
    return fail(err instanceof AppError ? err.message : "The address is not approved.");
  }
  if (login && !secrets.defaultAccountLabel) {
    return fail("Add a test account and mark one as default first.");
  }

  const timeoutMs = 120_000;
  let ok = false;
  let error: string | null = null;
  let storageState: string | null = null;
  for await (const event of runInSandbox({
    sessionId: `verify-${job.id}`,
    label: `verify:${env.id}`,
    origins,
    input: {
      mode: login ? "login" : "capture",
      baseURL: env.baseUrl,
      storageState: null,
      accounts: secrets.accounts,
      vars: secrets.vars,
      testTimeoutMs: Math.min(getEnv().RUN_TEST_TIMEOUT_SECONDS, 120) * 1000,
      retries: 0,
      slowMoMs: 0,
      tests: [],
      ...(login
        ? { login: { ...login, account: secrets.defaultAccountLabel ?? "" } }
        : { capture: { paths: ["/"] } }),
    },
    timeoutMs,
    signal,
  })) {
    if (event.t === "login") {
      ok = event.ok;
      error = event.error;
      storageState = event.storageState;
    } else if (event.t === "capture") {
      ok = true;
    } else if (event.t === "done" && !event.ok) {
      ok = false;
      error ??= event.error;
    }
  }
  if (!ok) {
    return fail(
      login
        ? `Sign-in failed: ${error ?? "the app did not respond as expected."}`
        : `The page could not be opened: ${error ?? "no response."}`,
    );
  }

  let storageStateKey: string | null = null;
  if (storageState) {
    storageStateKey = newObjectKey(env.projectId ?? "shared", "artifacts");
    // The session is a credential: encrypted before it leaves the worker.
    await getStorage().put(
      storageStateKey,
      Buffer.from(encryptBuffer(Buffer.from(storageState, "utf8")), "utf8"),
      "application/octet-stream",
    );
  }
  const old = env.storageStateKey;
  await db.environment.update({
    where: { id: env.id },
    data: {
      verifiedAt: new Date(),
      loginCheckStatus: login ? "OK" : "NOT_CHECKED",
      loginCheckedAt: new Date(),
      loginCheckError: null,
      storageStateKey,
    },
  });
  if (old && old !== storageStateKey) {
    await getStorage()
      .delete(old)
      .catch(() => undefined);
  }
  return { verified: true, signedIn: Boolean(login) };
};
