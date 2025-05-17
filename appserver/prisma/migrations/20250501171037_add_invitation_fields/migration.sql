/*
  Warnings:

  - A unique constraint covering the columns `[invitation_token]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "expires_at" TIMESTAMPTZ,
ADD COLUMN     "invitation_token" TEXT,
ADD COLUMN     "invited_by_id" INTEGER,
ADD COLUMN     "is_placeholder" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "users_invitation_token_key" ON "users"("invitation_token");

-- CreateIndex
CREATE INDEX "users_is_placeholder_idx" ON "users"("is_placeholder");

-- CreateIndex
CREATE INDEX "users_invitation_token_idx" ON "users"("invitation_token");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
