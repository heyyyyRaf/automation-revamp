-- AlterEnum
ALTER TYPE "RunStatus" ADD VALUE 'ABORTED';

-- AlterTable
ALTER TABLE "AllowedTarget" ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Environment" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "retries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "selection" JSONB,
ADD COLUMN     "slowMoMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timeoutSeconds" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "workers" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "RunTest" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "consoleKey" TEXT,
ADD COLUMN     "networkKey" TEXT;

-- AlterTable
ALTER TABLE "Script" ADD COLUMN     "needsEdit" BOOLEAN NOT NULL DEFAULT false;


-- Environments whose login check already passed count as verified (FRD verified_at).
UPDATE "Environment" SET "verifiedAt" = "loginCheckedAt" WHERE "loginCheckStatus" = 'OK';
