CREATE TABLE "OutboxJob" (
  "id" UUID NOT NULL, "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT, CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutboxJob_dispatchedAt_createdAt_idx" ON "OutboxJob"("dispatchedAt", "createdAt");
CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL, "type" VARCHAR(64) NOT NULL, "messageId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
