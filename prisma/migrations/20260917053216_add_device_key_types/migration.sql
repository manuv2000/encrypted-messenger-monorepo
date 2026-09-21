/*
  Warnings:

  - A unique constraint covering the columns `[deviceId,type,keyId]` on the table `DeviceKey` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `keyId` to the `DeviceKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `DeviceKey` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DeviceKeyType" AS ENUM ('IDENTITY_SIGNING', 'IDENTITY_DH', 'SIGNED_PREKEY', 'ONE_TIME_PREKEY');

-- DropIndex
DROP INDEX "DeviceKey_deviceId_idx";

-- DropIndex
DROP INDEX "DeviceKey_revokedAt_idx";

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DeviceKey" ADD COLUMN     "consumedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "keyId" INTEGER NOT NULL,
ADD COLUMN     "signature" TEXT,
ADD COLUMN     "type" "DeviceKeyType" NOT NULL;

-- CreateIndex
CREATE INDEX "Device_revokedAt_idx" ON "Device"("revokedAt");

-- CreateIndex
CREATE INDEX "DeviceKey_deviceId_type_revokedAt_idx" ON "DeviceKey"("deviceId", "type", "revokedAt");

-- CreateIndex
CREATE INDEX "DeviceKey_deviceId_type_consumedAt_idx" ON "DeviceKey"("deviceId", "type", "consumedAt");

-- CreateIndex
CREATE INDEX "DeviceKey_expiresAt_idx" ON "DeviceKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceKey_deviceId_type_keyId_key" ON "DeviceKey"("deviceId", "type", "keyId");
