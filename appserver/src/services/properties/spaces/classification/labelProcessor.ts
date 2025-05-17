import { SpaceType, Prisma } from "@prisma/client";
import { Label } from "@aws-sdk/client-rekognition";
import {
  ClassificationResult,
  LabelMapping,
  SpaceIndicators,
} from "./classificationTypes";

export class LabelProcessor {
  // Enhanced mapping of AWS Rekognition labels to SpaceType
  private readonly LABEL_TO_SPACE: LabelMapping = {
    // Kitchen indicators
    Kitchen: SpaceType.Kitchen,
    Oven: SpaceType.Kitchen,
    Refrigerator: SpaceType.Kitchen,
    Sink: SpaceType.Kitchen,
    Microwave: SpaceType.Kitchen,
    Dishwasher: SpaceType.Kitchen,
    Counter: SpaceType.Kitchen,
    "Kitchen Appliance": SpaceType.Kitchen,
    Stove: SpaceType.Kitchen,
    "Kitchen Island": SpaceType.Kitchen,
    Pantry: SpaceType.Kitchen,
    "Dining Table": SpaceType.Kitchen,
    "Dining Room": SpaceType.Kitchen,

    // Living Room indicators
    "Living Room": SpaceType.LivingRoom,
    Couch: SpaceType.LivingRoom,
    Sofa: SpaceType.LivingRoom,
    Television: SpaceType.LivingRoom,
    "Coffee Table": SpaceType.LivingRoom,
    "Entertainment Center": SpaceType.LivingRoom,
    Fireplace: SpaceType.LivingRoom,
    "Living Area": SpaceType.LivingRoom,
    Lounge: SpaceType.LivingRoom,
    "TV Room": SpaceType.LivingRoom,
    "Family Room": SpaceType.LivingRoom,
    Bookshelf: SpaceType.LivingRoom,
    "Sitting Area": SpaceType.LivingRoom,

    // Bedroom indicators
    Bedroom: SpaceType.Bedroom,
    Bed: SpaceType.Bedroom,
    Dresser: SpaceType.Bedroom,
    Wardrobe: SpaceType.Bedroom,
    Nightstand: SpaceType.Bedroom,
    "Bedside Table": SpaceType.Bedroom,
    "Master Bedroom": SpaceType.Bedroom,
    "Guest Room": SpaceType.Bedroom,

    // Bathroom indicators
    Bathroom: SpaceType.Bathroom,
    Toilet: SpaceType.Bathroom,
    Bathtub: SpaceType.Bathroom,
    Shower: SpaceType.Bathroom,
    Bath: SpaceType.Bathroom,
    "Bathroom Vanity": SpaceType.Bathroom,
    "Bathroom Cabinet": SpaceType.Bathroom,
    "Bathroom Sink": SpaceType.Bathroom,
    Mirror: SpaceType.Bathroom,

    // Hallway indicators
    Hallway: SpaceType.Hallway,
    Corridor: SpaceType.Hallway,
    Stairs: SpaceType.Hallway,
    Staircase: SpaceType.Hallway,
    "Entrance Hall": SpaceType.Hallway,
    Foyer: SpaceType.Hallway,
    Entryway: SpaceType.Hallway,
    Lobby: SpaceType.Hallway,

    // Exterior indicators
    Yard: SpaceType.Exterior,
    Garden: SpaceType.Exterior,
    Patio: SpaceType.Exterior,
    Building: SpaceType.Exterior,
    Porch: SpaceType.Exterior,
    Terrace: SpaceType.Exterior,
    Balcony: SpaceType.Exterior,
    Deck: SpaceType.Exterior,
    Lawn: SpaceType.Exterior,
    "Swimming Pool": SpaceType.Exterior,
    "Outdoor Area": SpaceType.Exterior,
    Driveway: SpaceType.Exterior,
    Walkway: SpaceType.Exterior,

    // Garage indicators
    Garage: SpaceType.Garage,
    Car: SpaceType.Garage,
    Parking: SpaceType.Garage,
    "Parking Space": SpaceType.Garage,
    "Parking Lot": SpaceType.Garage,
    "Parking Garage": SpaceType.Garage,
    "Car Park": SpaceType.Garage,
    Workshop: SpaceType.Garage,
  };

  // Additional space indicators with keywords for fuzzy matching
  private readonly SPACE_INDICATORS: SpaceIndicators = {
    [SpaceType.Kitchen]: {
      keywords: [
        "cook",
        "eating",
        "culinary",
        "food",
        "cabinet",
        "utensil",
        "appliance",
      ],
      weight: 0.7,
    },
    [SpaceType.LivingRoom]: {
      keywords: ["sitting", "relaxing", "watch", "lounge", "casual", "comfort"],
      weight: 0.7,
    },
    [SpaceType.Bedroom]: {
      keywords: [
        "sleep",
        "rest",
        "pillow",
        "blanket",
        "mattress",
        "bedroom furniture",
      ],
      weight: 0.8,
    },
    [SpaceType.Bathroom]: {
      keywords: [
        "wash",
        "hygiene",
        "clean",
        "towel",
        "plumbing",
        "toilet paper",
      ],
      weight: 0.8,
    },
    [SpaceType.Hallway]: {
      keywords: ["passage", "connecting", "transition", "narrow", "walkway"],
      weight: 0.6,
    },
    [SpaceType.Exterior]: {
      keywords: [
        "outside",
        "outdoor",
        "exterior",
        "garden",
        "nature",
        "sky",
        "cloud",
        "sun",
      ],
      weight: 0.7,
    },
    [SpaceType.Garage]: {
      keywords: ["vehicle", "storage", "equipment", "tool", "mechanical"],
      weight: 0.7,
    },
  };

  /**
   * Process detected labels to determine space type with enhanced matching
   */
  processLabels(labels: Label[]): ClassificationResult {
    // Track space type scores with improved weighting
    const spaceScores: Record<SpaceType, number> = {
      [SpaceType.Kitchen]: 0,
      [SpaceType.LivingRoom]: 0,
      [SpaceType.Bedroom]: 0,
      [SpaceType.Bathroom]: 0,
      [SpaceType.Hallway]: 0,
      [SpaceType.Exterior]: 0,
      [SpaceType.Garage]: 0,
      [SpaceType.Other]: 0,
      [SpaceType.Unknown]: 0,
    };

    // Extract all label names and descriptions for better matching
    const labelNames: string[] = [];
    const labelTexts: string[] = [];

    // Process each label with improved weighting
    labels.forEach((label) => {
      if (label.Name && label.Confidence) {
        const name = label.Name;
        labelNames.push(name);
        labelTexts.push(name.toLowerCase());

        // Direct mapping with full confidence
        if (this.LABEL_TO_SPACE[name]) {
          spaceScores[this.LABEL_TO_SPACE[name]] += label.Confidence;
        }

        // Also check parent labels
        label.Parents?.forEach((parent) => {
          if (parent.Name && this.LABEL_TO_SPACE[parent.Name]) {
            // Parent matches get lower weight
            spaceScores[this.LABEL_TO_SPACE[parent.Name]] +=
              (label.Confidence || 0) * 0.6;
          }
        });

        // Fuzzy keyword matching for additional confidence
        this.fuzzyMatchKeywords(
          name.toLowerCase(),
          label.Confidence,
          spaceScores,
        );
      }
    });

    // Apply context-based boosting
    this.applyContextBoosting(labelTexts.join(" "), spaceScores);

    // Find best space type with improved scoring
    let bestType: SpaceType = SpaceType.Unknown;
    let highestScore = 0;

    Object.entries(spaceScores).forEach(([type, score]) => {
      if (score > highestScore) {
        highestScore = score;
        bestType = type as SpaceType;
      }
    });

    // If no clear match but we have some labels, use Other instead of Unknown
    if (highestScore === 0 && labels.length > 0) {
      bestType = SpaceType.Other;
    }

    // Calculate confidence with improved normalization
    // Use a logarithmic scale for more reasonable confidence values
    const rawConfidence = highestScore / 500;
    const confidenceScore = Math.min(
      rawConfidence > 0
        ? Math.max(0.15, Math.log10(1 + rawConfidence) / Math.log10(2))
        : 0,
      0.99,
    );

    // Create feature vector
    const featureVector: Prisma.JsonValue = {
      dimensions: Object.values(SpaceType).map((type) =>
        type === bestType ? confidenceScore : 0,
      ) as Prisma.JsonValue,
      dominantColors: this.extractColors(labels),
      detectedObjects: this.extractObjects(labels),
    };

    return {
      spaceType: bestType,
      confidenceScore,
      labels: labelNames,
      featureVector,
    };
  }

  /**
   * Apply fuzzy keyword matching to boost space type scores
   */
  private fuzzyMatchKeywords(
    labelText: string,
    confidence: number,
    spaceScores: Record<SpaceType, number>,
  ): void {
    // Check each space type's keywords for matches
    Object.entries(this.SPACE_INDICATORS).forEach(([spaceType, data]) => {
      data.keywords.forEach((keyword) => {
        if (labelText.includes(keyword)) {
          // Add partial score based on keyword match
          spaceScores[spaceType as SpaceType] += confidence * data.weight;
        }
      });
    });
  }

  /**
   * Apply context-based boosting based on overall label set
   */
  private applyContextBoosting(
    allLabelsText: string,
    spaceScores: Record<SpaceType, number>,
  ): void {
    // Kitchen context clues
    if (
      allLabelsText.includes("food") &&
      (allLabelsText.includes("prepare") || allLabelsText.includes("cook"))
    ) {
      spaceScores[SpaceType.Kitchen] += 50;
    }

    // Living room context clues
    if (
      allLabelsText.includes("tv") &&
      (allLabelsText.includes("sofa") || allLabelsText.includes("couch"))
    ) {
      spaceScores[SpaceType.LivingRoom] += 50;
    }

    // Bedroom context clues
    if (
      allLabelsText.includes("bed") &&
      (allLabelsText.includes("sleep") || allLabelsText.includes("pillow"))
    ) {
      spaceScores[SpaceType.Bedroom] += 50;
    }

    // Bathroom context clues
    if (
      (allLabelsText.includes("shower") || allLabelsText.includes("toilet")) &&
      allLabelsText.includes("bathroom")
    ) {
      spaceScores[SpaceType.Bathroom] += 50;
    }

    // Exterior context clues
    if (
      allLabelsText.includes("sky") ||
      (allLabelsText.includes("outdoor") && allLabelsText.includes("building"))
    ) {
      spaceScores[SpaceType.Exterior] += 50;
    }

    // Garage context clues
    if (
      allLabelsText.includes("car") &&
      (allLabelsText.includes("garage") || allLabelsText.includes("parking"))
    ) {
      spaceScores[SpaceType.Garage] += 50;
    }
  }

  /**
   * Extract color information from labels
   */
  extractColors(labels: Label[]): string[] {
    const colorLabels = labels
      .filter(
        (label) =>
          label.Name?.toLowerCase().includes("color") ||
          [
            "white",
            "black",
            "red",
            "blue",
            "green",
            "yellow",
            "brown",
            "gray",
            "beige",
            "purple",
            "orange",
            "pink",
            "teal",
            "gold",
            "silver",
            "cream",
            "navy",
            "maroon",
          ].includes(label.Name?.toLowerCase() || ""),
      )
      .sort((a, b) => (b.Confidence || 0) - (a.Confidence || 0))
      .slice(0, 3)
      .map((label) => label.Name?.toLowerCase() || "");

    return colorLabels.length ? colorLabels : ["white", "beige", "gray"];
  }

  /**
   * Extract object information from labels with improved filtering
   */
  extractObjects(labels: Label[]): string[] {
    return labels
      .filter((label) => label.Confidence && label.Confidence > 70)
      .sort((a, b) => (b.Confidence || 0) - (a.Confidence || 0))
      .slice(0, 10)
      .map((label) => label.Name || "");
  }
}
