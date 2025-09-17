/*
  Warnings:

  - You are about to drop the `incident_images` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "incident_images" DROP CONSTRAINT "incident_images_incident_id_fkey";

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "ai_classified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "feature_vector" JSONB,
ADD COLUMN     "space_type" "SpaceType";

-- AlterTable
ALTER TABLE "property_images" ADD COLUMN     "incident_id" INTEGER;

-- DropTable
DROP TABLE "incident_images";

-- CreateTable
CREATE TABLE "image_object_labels" (
    "label_id" SERIAL NOT NULL,
    "image_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "category" TEXT,
    "bounding_box" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_object_labels_pkey" PRIMARY KEY ("label_id")
);

-- CreateTable
CREATE TABLE "incident_object_labels" (
    "label_id" SERIAL NOT NULL,
    "incident_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_object_labels_pkey" PRIMARY KEY ("label_id")
);

-- CreateIndex
CREATE INDEX "image_object_labels_image_id_idx" ON "image_object_labels"("image_id");

-- CreateIndex
CREATE INDEX "image_object_labels_name_idx" ON "image_object_labels"("name");

-- CreateIndex
CREATE INDEX "image_object_labels_category_idx" ON "image_object_labels"("category");

-- CreateIndex
CREATE INDEX "incident_object_labels_incident_id_idx" ON "incident_object_labels"("incident_id");

-- CreateIndex
CREATE INDEX "incident_object_labels_name_idx" ON "incident_object_labels"("name");

-- CreateIndex
CREATE INDEX "incident_object_labels_category_idx" ON "incident_object_labels"("category");

-- CreateIndex
CREATE INDEX "incidents_space_type_idx" ON "incidents"("space_type");

-- CreateIndex
CREATE INDEX "property_images_incident_id_idx" ON "property_images"("incident_id");

-- AddForeignKey
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("incident_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_object_labels" ADD CONSTRAINT "image_object_labels_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "property_images"("image_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_object_labels" ADD CONSTRAINT "incident_object_labels_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("incident_id") ON DELETE CASCADE ON UPDATE CASCADE;
