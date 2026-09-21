/*
  Warnings:

  - You are about to drop the column `ciphertext` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `nonce` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `Message` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[directKey]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[senderDeviceId,clientMessageId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `clientMessageId` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Added the required column `senderDeviceId` to the `Message` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DIRECT', 'GROUP');

-- CreateEnum
CREATE TYPE "EncryptedEnvelopeType" AS ENUM ('PREKEY', 'SESSION');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "directKey" TEXT,
ADD COLUMN     "type" "ConversationType" NOT NULL DEFAULT 'DIRECT';

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "ciphertext",
DROP COLUMN "nonce",
DROP COLUMN "version",
ADD COLUMN     "clientMessageId" TEXT NOT NULL,
ADD COLUMN     "senderDeviceId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "MessageEnvelope" (
    "messageId" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "envelopeType" "EncryptedEnvelopeType" NOT NULL,
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "MessageEnvelope_pkey" PRIMARY KEY ("messageId","recipientDeviceId")
);

-- CreateIndex
CREATE INDEX "MessageEnvelope_recipientDeviceId_deliveredAt_createdAt_idx" ON "MessageEnvelope"("recipientDeviceId", "deliveredAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");

-- CreateIndex
CREATE UNIQUE INDEX "Message_senderDeviceId_clientMessageId_key" ON "Message"("senderDeviceId", "clientMessageId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEnvelope" ADD CONSTRAINT "MessageEnvelope_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEnvelope" ADD CONSTRAINT "MessageEnvelope_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
