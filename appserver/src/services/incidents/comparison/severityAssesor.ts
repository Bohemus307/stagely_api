import { IncidentSeverity } from "@prisma/client";
import { ChangeType, DetectedChange } from "./comparisonTypes";

export class SeverityAssessor {
  /**
   * Assess the severity of an incident based on detected changes
   */
  assessSeverity(
    changes: DetectedChange[],
    baseSeverity: IncidentSeverity = IncidentSeverity.Low,
  ): IncidentSeverity {
    if (changes.length === 0) {
      return baseSeverity;
    }

    // Convert base severity to numeric value
    let severityScore = this.severityToScore(baseSeverity);

    // Check for critical changes
    const hasCriticalChange = changes.some(
      (change) =>
        (change.changeType === ChangeType.DAMAGED &&
          change.objectName
            .toLowerCase()
            .match(/gas|electrical|water main|structural|fire|roof/)) ||
        (change.changeType === ChangeType.REMOVED &&
          change.objectName
            .toLowerCase()
            .match(/safety|detector|alarm|extinguisher/)),
    );

    if (hasCriticalChange) {
      return IncidentSeverity.Critical;
    }

    // Calculate severity based on number and types of changes
    let damageCount = 0;
    let removedCount = 0;
    let addedCount = 0;

    changes.forEach((change) => {
      switch (change.changeType) {
        case ChangeType.DAMAGED:
          damageCount++;
          break;
        case ChangeType.REMOVED:
          removedCount++;
          break;
        case ChangeType.ADDED:
          addedCount++;
          break;
      }
    });

    // Increase severity based on quantity and type of changes
    severityScore += damageCount * 0.5; // Damage has highest weight
    severityScore += removedCount * 0.3; // Missing items next
    severityScore += addedCount * 0.1; // Added items lowest impact

    // Additional factors based on confidence
    const highConfidenceChanges = changes.filter(
      (change) => change.confidence > 0.8,
    );
    if (highConfidenceChanges.length > 2) {
      severityScore += 0.5;
    }

    // Convert numeric score back to severity enum
    return this.scoreToSeverity(severityScore);
  }

  /**
   * Convert severity enum to numeric score
   */
  private severityToScore(severity: IncidentSeverity): number {
    switch (severity) {
      case IncidentSeverity.Low:
        return 1;
      case IncidentSeverity.Medium:
        return 2;
      case IncidentSeverity.High:
        return 3;
      case IncidentSeverity.Critical:
        return 4;
      default:
        return 1;
    }
  }

  /**
   * Convert numeric score to severity enum
   */
  private scoreToSeverity(score: number): IncidentSeverity {
    if (score >= 4) {
      return IncidentSeverity.Critical;
    } else if (score >= 3) {
      return IncidentSeverity.High;
    } else if (score >= 2) {
      return IncidentSeverity.Medium;
    } else {
      return IncidentSeverity.Low;
    }
  }
}
