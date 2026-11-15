-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "content" SET DEFAULT '';

-- CreateTable
CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment"("messageId");

-- AddForeignKey
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
