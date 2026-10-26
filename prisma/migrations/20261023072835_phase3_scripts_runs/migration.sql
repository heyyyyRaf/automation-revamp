-- AlterTable
ALTER TABLE "Environment" ADD COLUMN     "loginConfig" JSONB;

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "error" TEXT,
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RunStep" ADD COLUMN     "category" TEXT;

-- AlterTable
ALTER TABLE "Script" ADD COLUMN     "environmentId" TEXT,
ADD COLUMN     "startPath" TEXT NOT NULL DEFAULT '/';

-- AlterTable
ALTER TABLE "ScriptVersion" ADD COLUMN     "notes" TEXT;
