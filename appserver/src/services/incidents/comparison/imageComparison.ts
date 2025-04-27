import {
  ComparisonConfig,
  DetectedLabel,
  DetectedChange,
  ChangeType,
  BoundingBox,
} from "./comparisonTypes";

export class ImageComparisonProcessor {
  private config: ComparisonConfig;

  constructor(config?: Partial<ComparisonConfig>) {
    // Default configuration values
    this.config = {
      minConfidenceThreshold: 0.7,
      similarityThreshold: 0.6,
      objectMatchThreshold: 0.7,
      damageDetectionSensitivity: 0.5,
      ...config,
    };
  }

  /**
   * Compare labels from before and after images to detect changes
   */
  compareImageLabels(
    beforeLabels: DetectedLabel[],
    afterLabels: DetectedLabel[],
  ): DetectedChange[] {
    const changes: DetectedChange[] = [];

    // Filter labels by confidence threshold
    const filteredBeforeLabels = beforeLabels.filter(
      (label) => label.confidence >= this.config.minConfidenceThreshold,
    );

    const filteredAfterLabels = afterLabels.filter(
      (label) => label.confidence >= this.config.minConfidenceThreshold,
    );

    // Find items that are in the "before" image but not in the "after" image (removed)
    filteredBeforeLabels.forEach((beforeLabel) => {
      const matchingAfterLabel = this.findMatchingLabel(
        beforeLabel,
        filteredAfterLabels,
      );

      if (!matchingAfterLabel) {
        // Item removed - create a change with default bounding box if needed
        const defaultBox: BoundingBox =
          beforeLabel.boundingBox || this.createDefaultBoundingBox();

        changes.push({
          changeType: ChangeType.REMOVED,
          objectName: beforeLabel.name,
          confidence: beforeLabel.confidence,
          description: `${beforeLabel.name} is missing from the recent image`,
          boundingBox: defaultBox,
          before: {
            confidence: beforeLabel.confidence,
            boundingBox: defaultBox,
          },
        });
      } else if (this.isDamaged(beforeLabel, matchingAfterLabel)) {
        // Item potentially damaged
        const beforeBox: BoundingBox =
          beforeLabel.boundingBox || this.createDefaultBoundingBox();
        const afterBox: BoundingBox =
          matchingAfterLabel.boundingBox || this.createDefaultBoundingBox();

        changes.push({
          changeType: ChangeType.DAMAGED,
          objectName: beforeLabel.name,
          confidence: Math.min(
            beforeLabel.confidence,
            matchingAfterLabel.confidence,
          ),
          description: `${beforeLabel.name} appears to be damaged`,
          boundingBox: afterBox,
          before: {
            confidence: beforeLabel.confidence,
            boundingBox: beforeBox,
          },
          after: {
            confidence: matchingAfterLabel.confidence,
            boundingBox: afterBox,
          },
        });
      } else if (this.hasMoved(beforeLabel, matchingAfterLabel)) {
        // Item moved
        const beforeBox: BoundingBox =
          beforeLabel.boundingBox || this.createDefaultBoundingBox();
        const afterBox: BoundingBox =
          matchingAfterLabel.boundingBox || this.createDefaultBoundingBox();

        changes.push({
          changeType: ChangeType.MOVED,
          objectName: beforeLabel.name,
          confidence: Math.min(
            beforeLabel.confidence,
            matchingAfterLabel.confidence,
          ),
          description: `${beforeLabel.name} has been moved`,
          boundingBox: afterBox,
          before: {
            confidence: beforeLabel.confidence,
            boundingBox: beforeBox,
          },
          after: {
            confidence: matchingAfterLabel.confidence,
            boundingBox: afterBox,
          },
        });
      }
    });

    // Find items that are in the "after" image but not in the "before" image (added)
    filteredAfterLabels.forEach((afterLabel) => {
      const matchingBeforeLabel = this.findMatchingLabel(
        afterLabel,
        filteredBeforeLabels,
      );

      if (!matchingBeforeLabel) {
        // New item added
        const defaultBox: BoundingBox =
          afterLabel.boundingBox || this.createDefaultBoundingBox();

        changes.push({
          changeType: ChangeType.ADDED,
          objectName: afterLabel.name,
          confidence: afterLabel.confidence,
          description: `New ${afterLabel.name} detected`,
          boundingBox: defaultBox,
          after: {
            confidence: afterLabel.confidence,
            boundingBox: defaultBox,
          },
        });
      }
    });

    return changes;
  }

  /**
   * Create a default bounding box for when one is not available
   */
  private createDefaultBoundingBox(): BoundingBox {
    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
  }

  /**
   * Find a matching label in a collection of labels
   */
  private findMatchingLabel(
    sourceLabel: DetectedLabel,
    targetLabels: DetectedLabel[],
  ): DetectedLabel | null {
    // First try exact name match
    const exactMatches = targetLabels.filter(
      (label) => label.name.toLowerCase() === sourceLabel.name.toLowerCase(),
    );

    if (exactMatches.length > 0) {
      // If multiple exact matches, find the closest one by position if bounding boxes exist
      if (exactMatches.length > 1 && sourceLabel.boundingBox) {
        return this.findClosestByPosition(sourceLabel, exactMatches);
      }
      return exactMatches[0];
    }

    // Try semantic similarity (could be improved with embeddings)
    // For now, check for partial matches and parent/child relationships
    for (const label of targetLabels) {
      // Check if one is substring of the other
      if (
        label.name.toLowerCase().includes(sourceLabel.name.toLowerCase()) ||
        sourceLabel.name.toLowerCase().includes(label.name.toLowerCase())
      ) {
        return label;
      }

      // Check if they share parent categories
      const sourceParents = sourceLabel.parentNames || [];
      const targetParents = label.parentNames || [];

      const sharedParents = sourceParents.filter((parent) =>
        targetParents.includes(parent),
      );

      if (sharedParents.length > 0) {
        return label;
      }
    }

    return null;
  }

  /**
   * Find the label closest in position to the source label
   */
  private findClosestByPosition(
    sourceLabel: DetectedLabel,
    candidateLabels: DetectedLabel[],
  ): DetectedLabel {
    // Default to first candidate if source has no bounding box
    if (!sourceLabel.boundingBox) {
      return candidateLabels[0];
    }

    let closestLabel = candidateLabels[0];
    let smallestDistance = Number.MAX_VALUE;

    candidateLabels.forEach((label) => {
      if (label.boundingBox) {
        const distance = this.calculateBoxDistance(
          sourceLabel.boundingBox!,
          label.boundingBox,
        );

        if (distance < smallestDistance) {
          smallestDistance = distance;
          closestLabel = label;
        }
      }
    });

    return closestLabel;
  }

  /**
   * Calculate the distance between two bounding boxes
   */
  private calculateBoxDistance(box1: BoundingBox, box2: BoundingBox): number {
    const center1 = {
      x: box1.left + box1.width / 2,
      y: box1.top + box1.height / 2,
    };

    const center2 = {
      x: box2.left + box2.width / 2,
      y: box2.top + box2.height / 2,
    };

    return Math.sqrt(
      Math.pow(center2.x - center1.x, 2) + Math.pow(center2.y - center1.y, 2),
    );
  }

  /**
   * Check if an object appears to be damaged based on confidence changes
   */
  private isDamaged(
    beforeLabel: DetectedLabel,
    afterLabel: DetectedLabel,
  ): boolean {
    // If confidence dropped significantly, it might be damaged
    const confidenceDropRatio =
      (beforeLabel.confidence - afterLabel.confidence) / beforeLabel.confidence;

    return confidenceDropRatio > this.config.damageDetectionSensitivity;
  }

  /**
   * Check if an object has moved based on bounding box position
   */
  private hasMoved(
    beforeLabel: DetectedLabel,
    afterLabel: DetectedLabel,
  ): boolean {
    // Can't determine movement without bounding boxes
    if (!beforeLabel.boundingBox || !afterLabel.boundingBox) {
      return false;
    }

    const movementThreshold = 0.2; // 20% of image width/height

    const beforeCenter = {
      x: beforeLabel.boundingBox.left + beforeLabel.boundingBox.width / 2,
      y: beforeLabel.boundingBox.top + beforeLabel.boundingBox.height / 2,
    };

    const afterCenter = {
      x: afterLabel.boundingBox.left + afterLabel.boundingBox.width / 2,
      y: afterLabel.boundingBox.top + afterLabel.boundingBox.height / 2,
    };

    const xDiff = Math.abs(afterCenter.x - beforeCenter.x);
    const yDiff = Math.abs(afterCenter.y - beforeCenter.y);

    return xDiff > movementThreshold || yDiff > movementThreshold;
  }
}
