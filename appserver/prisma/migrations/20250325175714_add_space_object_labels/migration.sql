-- CreateTable
CREATE TABLE "space_object_labels" (
    "label_id" SERIAL NOT NULL,
    "space_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_object_labels_pkey" PRIMARY KEY ("label_id")
);

-- CreateIndex
CREATE INDEX "space_object_labels_space_id_idx" ON "space_object_labels"("space_id");

-- CreateIndex
CREATE INDEX "space_object_labels_name_idx" ON "space_object_labels"("name");

-- CreateIndex
CREATE INDEX "space_object_labels_category_idx" ON "space_object_labels"("category");

-- AddForeignKey
ALTER TABLE "space_object_labels" ADD CONSTRAINT "space_object_labels_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "property_spaces"("space_id") ON DELETE CASCADE ON UPDATE CASCADE;
