-- CreateTable
CREATE TABLE "x_credentials" (
    "id" SERIAL NOT NULL,
    "access_token" TEXT,
    "access_secret" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "github_username" TEXT,

    CONSTRAINT "x_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unique_github_username" ON "x_credentials"("github_username");
