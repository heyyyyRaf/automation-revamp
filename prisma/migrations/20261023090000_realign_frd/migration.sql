-- Realign the data model with the FRD (v0.1). Hand-edited so that no existing data is lost.

-- CreateEnum
CREATE TYPE "DocumentTag" AS ENUM ('FRD', 'USER_STORY', 'FIGMA', 'FLOW_DIAGRAM', 'OTHER');
CREATE TYPE "RequirementStatus" AS ENUM ('ACTIVE', 'NEEDS_REVIEW', 'MERGED');
CREATE TYPE "TestCaseStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'SCRIPTED', 'PASSED', 'FAILED', 'ERROR');
CREATE TYPE "CommentTarget" AS ENUM ('TEST_CASE', 'RUN');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'REWRITE_TEST_CASE';

-- Requirement types: map the old categories onto the FRD's (FR-3.1).
BEGIN;
CREATE TYPE "RequirementType_new" AS ENUM ('FEATURE', 'USER_ACTION', 'FIELD', 'VALIDATION', 'BUSINESS_RULE', 'EXPECTED_RESULT', 'FLOW', 'NON_FUNCTIONAL', 'OTHER');
ALTER TABLE "Requirement" ALTER COLUMN "type" TYPE "RequirementType_new" USING (
  CASE "type"::text
    WHEN 'FUNCTIONAL' THEN 'FEATURE'
    WHEN 'UI' THEN 'FIELD'
    WHEN 'DATA' THEN 'FIELD'
    WHEN 'SECURITY' THEN 'VALIDATION'
    ELSE "type"::text
  END
)::"RequirementType_new";
ALTER TYPE "RequirementType" RENAME TO "RequirementType_old";
ALTER TYPE "RequirementType_new" RENAME TO "RequirementType";
DROP TYPE "public"."RequirementType_old";
COMMIT;

-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN "promptVersion" TEXT;

ALTER TABLE "AuditLog" ADD COLUMN "after" JSONB,
ADD COLUMN "before" JSONB;

-- File tags (FR-2.3): start from the upload area each file was added to.
ALTER TABLE "Document" ADD COLUMN "typeTag" "DocumentTag" NOT NULL DEFAULT 'OTHER';
UPDATE "Document" SET "typeTag" = CASE "category"::text
  WHEN 'REQUIREMENTS' THEN 'FRD'::"DocumentTag"
  WHEN 'SYSTEM_FLOW' THEN 'FLOW_DIAGRAM'::"DocumentTag"
  WHEN 'FIGMA' THEN 'FIGMA'::"DocumentTag"
  ELSE 'OTHER'::"DocumentTag"
END;

-- Project owner (FR-1.1): existing projects are owned by their creator.
ALTER TABLE "Project" ADD COLUMN "nextScenarioNo" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "ownerId" TEXT;
UPDATE "Project" SET "ownerId" = "createdById";
ALTER TABLE "Project" ALTER COLUMN "ownerId" SET NOT NULL;

ALTER TABLE "Requirement" ADD COLUMN "mergedIntoId" TEXT,
ADD COLUMN "status" "RequirementStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "updatedById" TEXT;

-- Test case status: same values carried over into the longer FRD lifecycle.
ALTER TABLE "TestCase" ADD COLUMN "createdById" TEXT,
ADD COLUMN "scenarioId" TEXT,
ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "updatedById" TEXT;
ALTER TABLE "TestCase" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TestCase" ALTER COLUMN "status" TYPE "TestCaseStatus" USING ("status"::text::"TestCaseStatus");
ALTER TABLE "TestCase" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "flowSteps" JSONB NOT NULL,
    "userFlowId" TEXT,
    "origin" "Origin" NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "targetType" "CommentTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Scenario_projectId_idx" ON "Scenario"("projectId");
CREATE UNIQUE INDEX "Scenario_projectId_key_key" ON "Scenario"("projectId", "key");
CREATE INDEX "Comment_projectId_targetType_targetId_createdAt_idx" ON "Comment"("projectId", "targetType", "targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
