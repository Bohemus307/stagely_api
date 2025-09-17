import { Label } from "@aws-sdk/client-rekognition";
import { DetectedLabel } from "./comparisonTypes";
import { IncidentSeverity } from "@prisma/client";

/**
 * Service for processing labels to identify potential incidents
 */
export class IncidentLabelProcessor {
  // Maps of labels to incident types and severities
  private incidentTypeMap: Record<string, string> = {
    // Damage related
    Damage: "Property Damage",
    Crack: "Structural Damage",
    Broken: "Property Damage",
    Hole: "Property Damage",
    Stain: "Cleaning Required",
    Dirt: "Cleaning Required",
    Spill: "Cleaning Required",
    Rust: "Maintenance Required",
    Corrosion: "Maintenance Required",
    Mold: "Health Hazard",
    Mildew: "Health Hazard",
    Leak: "Plumbing Issue",
    Flood: "Water Damage",
    Water: "Water Damage",
    Fire: "Fire Damage",
    Smoke: "Smoke Damage",
    Vandalism: "Security Issue",
    Graffiti: "Security Issue",

    // Safety related
    "Exposed Wiring": "Electrical Hazard",
    Electrical: "Electrical Hazard",
    Wire: "Potential Hazard",
    "Trip Hazard": "Safety Issue",
    Hazard: "Safety Issue",
    "Sharp Object": "Safety Issue",

    // Maintenance related
    "Missing Tile": "Maintenance Required",
    "Peeling Paint": "Maintenance Required",
    "Loose Handrail": "Maintenance Required",
    "HVAC Issue": "Maintenance Required",
    "Plumbing Issue": "Maintenance Required",

    // Security related
    "Broken Lock": "Security Issue",
    "Broken Window": "Security Issue",
    "Broken Door": "Security Issue",
    "Forced Entry": "Security Issue",

    // Pest related
    Pest: "Pest Control",
    Insect: "Pest Control",
    Rodent: "Pest Control",
  };

  private severityMap: Record<string, IncidentSeverity> = {
    // High severity issues
    Fire: IncidentSeverity.High,
    Flood: IncidentSeverity.High,
    "Exposed Wiring": IncidentSeverity.High,
    "Gas Leak": IncidentSeverity.High,
    Mold: IncidentSeverity.High,

    // Medium severity issues
    "Water Damage": IncidentSeverity.Medium,
    "Structural Damage": IncidentSeverity.Medium,
    "Broken Window": IncidentSeverity.Medium,
    "Broken Door": IncidentSeverity.Medium,
    "Plumbing Issue": IncidentSeverity.Medium,

    // Low severity issues
    "Cleaning Required": IncidentSeverity.Low,
    "Maintenance Required": IncidentSeverity.Low,
    "Cosmetic Issue": IncidentSeverity.Low,
  };

  /**
   * Process the labels from an image to identify potential incidents
   */
  processLabelsForIncidents(labels: Label[]): {
    incidentType: string;
    severity: IncidentSeverity;
    confidence: number;
    detectedLabels: DetectedLabel[];
  } {
    // Convert AWS labels to our format
    const detectedLabels = this.convertLabels(labels);

    // Find potential incidents based on labels
    const potentialIncidents = this.identifyPotentialIncidents(detectedLabels);

    // Determine most likely incident type and severity
    const { incidentType, severity, confidence } =
      this.determineMostLikelyIncident(potentialIncidents);

    return {
      incidentType,
      severity,
      confidence,
      detectedLabels,
    };
  }

  /**
   * Convert AWS Rekognition labels to our internal format
   */
  private convertLabels(labels: Label[]): DetectedLabel[] {
    return labels.map((label) => {
      let boundingBox = undefined;

      // Safely check for bounding box information
      if (
        label.Instances &&
        label.Instances.length > 0 &&
        label.Instances[0]?.BoundingBox
      ) {
        const rekBoundingBox = label.Instances[0].BoundingBox;

        // Only create a bounding box if all required properties exist
        if (
          typeof rekBoundingBox.Left === "number" &&
          typeof rekBoundingBox.Top === "number" &&
          typeof rekBoundingBox.Width === "number" &&
          typeof rekBoundingBox.Height === "number"
        ) {
          boundingBox = {
            left: rekBoundingBox.Left,
            top: rekBoundingBox.Top,
            width: rekBoundingBox.Width,
            height: rekBoundingBox.Height,
          };
        }
      }

      return {
        name: label.Name || "",
        confidence: (label.Confidence || 0) / 100, // Convert to 0-1 range
        parentNames: label.Parents?.map((p) => p.Name || "") || [],
        boundingBox,
      };
    });
  }

  /**
   * Identify potential incidents based on detected labels
   */
  private identifyPotentialIncidents(labels: DetectedLabel[]): Array<{
    incidentType: string;
    severity: IncidentSeverity;
    confidence: number;
  }> {
    const incidents: Array<{
      incidentType: string;
      severity: IncidentSeverity;
      confidence: number;
    }> = [];

    // Check each label against our known incident types
    for (const label of labels) {
      // Direct match with label name
      if (this.incidentTypeMap[label.name]) {
        const incidentType = this.incidentTypeMap[label.name];
        const severity = this.severityMap[incidentType] || IncidentSeverity.Low;

        incidents.push({
          incidentType,
          severity,
          confidence: label.confidence,
        });
        continue;
      }

      // Check for partial matches (e.g. "broken glass" should match "broken")
      for (const knownLabel of Object.keys(this.incidentTypeMap)) {
        if (
          label.name.toLowerCase().includes(knownLabel.toLowerCase()) ||
          knownLabel.toLowerCase().includes(label.name.toLowerCase())
        ) {
          const incidentType = this.incidentTypeMap[knownLabel];
          const severity =
            this.severityMap[incidentType] || IncidentSeverity.Low;

          // Reduce confidence for partial matches
          const confidence = label.confidence * 0.8;

          incidents.push({
            incidentType,
            severity,
            confidence,
          });
          break;
        }
      }
    }

    // If no incidents found, create a general "Inspection" entry
    if (incidents.length === 0) {
      incidents.push({
        incidentType: "General Inspection",
        severity: IncidentSeverity.Low,
        confidence: 0.5,
      });
    }

    return incidents;
  }

  /**
   * Determine the most likely incident based on confidence scores
   */
  private determineMostLikelyIncident(
    incidents: Array<{
      incidentType: string;
      severity: IncidentSeverity;
      confidence: number;
    }>,
  ): {
    incidentType: string;
    severity: IncidentSeverity;
    confidence: number;
  } {
    // If no incidents found, return a default
    if (incidents.length === 0) {
      return {
        incidentType: "Unknown Issue",
        severity: IncidentSeverity.Low,
        confidence: 0.3,
      };
    }

    // Sort by confidence (highest first)
    incidents.sort((a, b) => b.confidence - a.confidence);

    // Get the most confident incident
    const topIncident = incidents[0];

    // If we have multiple high-confidence issues, upgrade severity if needed
    if (
      incidents.length > 1 &&
      incidents[1].confidence > 0.7 &&
      this.getSeverityValue(incidents[1].severity) >
        this.getSeverityValue(topIncident.severity)
    ) {
      return {
        ...topIncident,
        severity: incidents[1].severity,
      };
    }

    return topIncident;
  }

  /**
   * Convert severity enum to numeric value for comparison
   */
  private getSeverityValue(severity: IncidentSeverity): number {
    switch (severity) {
      case IncidentSeverity.Low:
        return 1;
      case IncidentSeverity.Medium:
        return 2;
      case IncidentSeverity.High:
        return 3;
      default:
        return 0;
    }
  }
}
