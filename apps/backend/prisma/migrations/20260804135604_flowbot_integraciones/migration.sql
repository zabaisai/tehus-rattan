-- CreateEnum
CREATE TYPE "FlowBotCredentialType" AS ENUM ('API_KEY_HEADER', 'BEARER_TOKEN', 'BASIC_AUTH');

-- CreateTable
CREATE TABLE "flowbot_credentials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FlowBotCredentialType" NOT NULL,
    "headerName" TEXT,
    "username" TEXT,
    "secretEncrypted" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "flowbot_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flowbot_settings" (
    "id" TEXT NOT NULL,
    "httpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "httpAllowedHosts" TEXT[],
    "httpTimeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "httpMaxResponseBytes" INTEGER NOT NULL DEFAULT 262144,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "aiApiKeyEncrypted" TEXT,
    "aiMaxTokensPerCall" INTEGER NOT NULL DEFAULT 500,
    "aiMaxCallsPerDay" INTEGER NOT NULL DEFAULT 500,
    "aiTimeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "aiRedactPii" BOOLEAN NOT NULL DEFAULT true,
    "aiSystemPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "flowbot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flowbot_ai_usage" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costMillis" INTEGER NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "flowbot_ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flowbot_credentials_companyId_idx" ON "flowbot_credentials"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "flowbot_credentials_companyId_name_key" ON "flowbot_credentials"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "flowbot_settings_companyId_key" ON "flowbot_settings"("companyId");

-- CreateIndex
CREATE INDEX "flowbot_ai_usage_companyId_day_idx" ON "flowbot_ai_usage"("companyId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "flowbot_ai_usage_companyId_day_key" ON "flowbot_ai_usage"("companyId", "day");

-- AddForeignKey
ALTER TABLE "flowbot_credentials" ADD CONSTRAINT "flowbot_credentials_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_settings" ADD CONSTRAINT "flowbot_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_ai_usage" ADD CONSTRAINT "flowbot_ai_usage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
