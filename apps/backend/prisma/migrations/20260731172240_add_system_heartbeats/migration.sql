-- CreateTable
CREATE TABLE "system_heartbeats" (
    "component" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "detail" JSONB,

    CONSTRAINT "system_heartbeats_pkey" PRIMARY KEY ("component")
);
