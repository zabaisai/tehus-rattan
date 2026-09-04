-- Fase 4.5 — verificación de dispositivo al iniciar sesión.
--
-- ADITIVA Y SEGURA: crea dos tablas nuevas y sus índices. No altera, renombra
-- ni borra ninguna columna, tabla o fila existente, así que volver al código
-- anterior no exige revertir datos: las tablas quedan sin uso.

-- Reto de verificación (código de un solo uso enviado por correo).
CREATE TABLE "device_verification_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "resendAvailableAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "deviceIdHash" TEXT,
    "ipPreview" TEXT,
    "browser" TEXT,
    "operatingSystem" TEXT,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_verification_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_verification_challenges_userId_idx" ON "device_verification_challenges"("userId");
CREATE INDEX "device_verification_challenges_expiresAt_idx" ON "device_verification_challenges"("expiresAt");

ALTER TABLE "device_verification_challenges"
    ADD CONSTRAINT "device_verification_challenges_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dispositivo confiable (evita repetir el código mientras siga vigente).
CREATE TABLE "trusted_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceIdHash" TEXT,
    "ipPreview" TEXT,
    "browser" TEXT,
    "operatingSystem" TEXT,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- El token vive solo en una cookie httpOnly; aquí su SHA-256, único.
CREATE UNIQUE INDEX "trusted_devices_tokenHash_key" ON "trusted_devices"("tokenHash");
CREATE INDEX "trusted_devices_userId_idx" ON "trusted_devices"("userId");
CREATE INDEX "trusted_devices_expiresAt_idx" ON "trusted_devices"("expiresAt");

ALTER TABLE "trusted_devices"
    ADD CONSTRAINT "trusted_devices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
