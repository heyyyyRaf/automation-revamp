-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'IMPORT_FIGMA';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "derivedFromId" TEXT;

-- AlterTable
ALTER TABLE "Export" ADD COLUMN     "error" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "jobId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "nextRequirementNo" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nextTestCaseNo" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "UserFlow" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_derivedFromId_fkey" FOREIGN KEY ("derivedFromId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
