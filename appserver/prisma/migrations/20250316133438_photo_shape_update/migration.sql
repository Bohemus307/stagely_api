/*
  Warnings:

  - You are about to drop the column `property_id` on the `property_images` table. All the data in the column will be lost.
  - Added the required column `inspection_id` to the `property_images` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SpaceType" AS ENUM ('Kitchen', 'LivingRoom', 'Bedroom', 'Bathroom', 'Hallway', 'Exterior', 'Garage', 'Other', 'Unknown');

-- DropForeignKey
ALTER TABLE "property_images" DROP CONSTRAINT "property_images_property_id_fkey";

-- DropIndex
DROP INDEX "property_images_property_id_idx";

-- AlterTable
ALTER TABLE "property_images" DROP COLUMN "property_id",
ADD COLUMN     "feature_vector" JSONB,
ADD COLUMN     "inspection_id" INTEGER NOT NULL,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "space_id" INTEGER;

-- CreateTable
CREATE TABLE "inspections" (
    "inspection_id" SERIAL NOT NULL,
    "property_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Inspection',
    "description" TEXT,
    "inspection_date" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("inspection_id")
);

-- CreateTable
CREATE TABLE "property_spaces" (
    "space_id" SERIAL NOT NULL,
    "property_id" INTEGER NOT NULL,
    "name" TEXT,
    "type" "SpaceType" NOT NULL DEFAULT 'Unknown',
    "ai_generated" BOOLEAN NOT NULL DEFAULT true,
    "feature_vector" JSONB,
    "confidence_score" DECIMAL(5,4),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_spaces_pkey" PRIMARY KEY ("space_id")
);

-- CreateTable
CREATE TABLE "image_similarities" (
    "similarity_id" SERIAL NOT NULL,
    "base_image_id" INTEGER NOT NULL,
    "compared_image_id" INTEGER NOT NULL,
    "similarity_score" DECIMAL(5,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_similarities_pkey" PRIMARY KEY ("similarity_id")
);

-- CreateTable
CREATE TABLE "image_changes" (
    "change_id" SERIAL NOT NULL,
    "image_id" INTEGER NOT NULL,
    "change_type" TEXT NOT NULL,
    "description" TEXT,
    "bounding_box" JSONB,
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_changes_pkey" PRIMARY KEY ("change_id")
);

-- CreateIndex
CREATE INDEX "inspections_property_id_idx" ON "inspections"("property_id");

-- CreateIndex
CREATE INDEX "inspections_inspection_date_idx" ON "inspections"("inspection_date");

-- CreateIndex
CREATE INDEX "property_spaces_property_id_idx" ON "property_spaces"("property_id");

-- CreateIndex
CREATE INDEX "property_spaces_type_idx" ON "property_spaces"("type");

-- CreateIndex
CREATE INDEX "image_similarities_base_image_id_idx" ON "image_similarities"("base_image_id");

-- CreateIndex
CREATE INDEX "image_similarities_compared_image_id_idx" ON "image_similarities"("compared_image_id");

-- CreateIndex
CREATE INDEX "image_similarities_similarity_score_idx" ON "image_similarities"("similarity_score");

-- CreateIndex
CREATE UNIQUE INDEX "image_similarities_base_image_id_compared_image_id_key" ON "image_similarities"("base_image_id", "compared_image_id");

-- CreateIndex
CREATE INDEX "image_changes_image_id_idx" ON "image_changes"("image_id");

-- CreateIndex
CREATE INDEX "image_changes_change_type_idx" ON "image_changes"("change_type");

-- CreateIndex
CREATE INDEX "image_changes_verified_idx" ON "image_changes"("verified");

-- CreateIndex
CREATE INDEX "property_images_inspection_id_idx" ON "property_images"("inspection_id");

-- CreateIndex
CREATE INDEX "property_images_space_id_idx" ON "property_images"("space_id");

-- CreateIndex
CREATE INDEX "property_images_taken_at_idx" ON "property_images"("taken_at");

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("property_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_spaces" ADD CONSTRAINT "property_spaces_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("property_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("inspection_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "property_spaces"("space_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_similarities" ADD CONSTRAINT "image_similarities_base_image_id_fkey" FOREIGN KEY ("base_image_id") REFERENCES "property_images"("image_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_similarities" ADD CONSTRAINT "image_similarities_compared_image_id_fkey" FOREIGN KEY ("compared_image_id") REFERENCES "property_images"("image_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_changes" ADD CONSTRAINT "image_changes_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "property_images"("image_id") ON DELETE CASCADE ON UPDATE CASCADE;
