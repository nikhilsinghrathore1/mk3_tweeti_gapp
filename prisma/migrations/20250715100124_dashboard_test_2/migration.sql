-- AlterTable
ALTER TABLE "x_credentials" ADD COLUMN     "X_username" TEXT,
ADD COLUMN     "commits" TEXT[],
ADD COLUMN     "email" TEXT,
ADD COLUMN     "generated_msg" TEXT,
ADD COLUMN     "image" TEXT,
ADD COLUMN     "ispremium" BOOLEAN DEFAULT false,
ADD COLUMN     "scheduled_time" TIMESTAMP(3),
ADD COLUMN     "tone" TEXT;
