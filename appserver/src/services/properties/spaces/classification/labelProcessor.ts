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
    Pantry: SpaceType.Pantry,
    "Food Storage": SpaceType.Pantry,

    // Dining Room indicators
    "Dining Table": SpaceType.DiningRoom,
    "Dining Room": SpaceType.DiningRoom,
    "Dining Chair": SpaceType.DiningRoom,
    "China Cabinet": SpaceType.DiningRoom,
    Buffet: SpaceType.DiningRoom,

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
    "Sitting Area": SpaceType.LivingRoom,

    // Bedroom indicators
    Bedroom: SpaceType.Bedroom,
    Bed: SpaceType.Bedroom,
    Dresser: SpaceType.Bedroom,
    Nightstand: SpaceType.Bedroom,
    "Bedside Table": SpaceType.Bedroom,

    // Master Bedroom
    "Master Bedroom": SpaceType.MasterBedroom,
    "Master Suite": SpaceType.MasterBedroom,
    "King Bed": SpaceType.MasterBedroom,
    "Queen Bed": SpaceType.Bedroom,

    // Guest Room
    "Guest Room": SpaceType.GuestRoom,
    "Guest Bedroom": SpaceType.GuestRoom,

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
    "Entrance Hall": SpaceType.Hallway,
    Entryway: SpaceType.Hallway,

    // Foyer
    Foyer: SpaceType.Foyer,
    Lobby: SpaceType.Foyer,
    "Front Entry": SpaceType.Foyer,
    "Grand Entrance": SpaceType.Foyer,

    // Office indicators
    Office: SpaceType.Office,
    "Home Office": SpaceType.Office,
    Desk: SpaceType.Office,
    "Office Chair": SpaceType.Office,
    Computer: SpaceType.Office,
    "Office Desk": SpaceType.Office,
    Workstation: SpaceType.Office,
    Study: SpaceType.Office,

    // Library
    Library: SpaceType.Library,
    Bookshelf: SpaceType.Library,
    "Book Collection": SpaceType.Library,
    "Reading Room": SpaceType.Library,

    // Basement
    Basement: SpaceType.Basement,
    Cellar: SpaceType.Basement,
    "Lower Level": SpaceType.Basement,

    // Attic
    Attic: SpaceType.Attic,
    Loft: SpaceType.Attic,
    "Upper Level Storage": SpaceType.Attic,

    // Laundry
    "Laundry Room": SpaceType.Laundry,
    "Washing Machine": SpaceType.Laundry,
    Dryer: SpaceType.Laundry,
    "Laundry Basket": SpaceType.Laundry,
    "Utility Room": SpaceType.Laundry,

    // Closet
    Closet: SpaceType.Closet,
    Wardrobe: SpaceType.Closet,
    "Walk-in Closet": SpaceType.Closet,
    "Storage Closet": SpaceType.Closet,

    // Mudroom
    Mudroom: SpaceType.Mudroom,
    "Entry Storage": SpaceType.Mudroom,
    "Boot Room": SpaceType.Mudroom,

    // Game Room
    "Game Room": SpaceType.GameRoom,
    "Pool Table": SpaceType.GameRoom,
    Billiards: SpaceType.GameRoom,
    "Recreation Room": SpaceType.GameRoom,
    "Rec Room": SpaceType.GameRoom,

    // Home Theater
    "Home Theater": SpaceType.HomeTheater,
    "Theater Room": SpaceType.HomeTheater,
    "Media Room": SpaceType.HomeTheater,
    "Projection Screen": SpaceType.HomeTheater,

    // Gym
    Gym: SpaceType.Gym,
    "Home Gym": SpaceType.Gym,
    "Exercise Equipment": SpaceType.Gym,
    "Workout Room": SpaceType.Gym,
    "Fitness Room": SpaceType.Gym,
    Treadmill: SpaceType.Gym,
    "Weight Bench": SpaceType.Gym,

    // Studio
    Studio: SpaceType.Studio,
    "Art Studio": SpaceType.Studio,
    "Music Studio": SpaceType.Studio,
    "Recording Studio": SpaceType.Studio,
    "Creative Space": SpaceType.Studio,

    // Stairs indicators
    Stairs: SpaceType.Hallway,
    Staircase: SpaceType.Hallway,

    // Exterior indicators
    Building: SpaceType.Exterior,
    "Outdoor Area": SpaceType.Exterior,

    // Yard
    Yard: SpaceType.Yard,
    Garden: SpaceType.Yard,
    Lawn: SpaceType.Yard,
    "Back Yard": SpaceType.Yard,
    "Front Yard": SpaceType.Yard,

    // Patio
    Patio: SpaceType.Patio,
    Terrace: SpaceType.Patio,
    "Outdoor Seating": SpaceType.Patio,

    // Balcony
    Balcony: SpaceType.Balcony,
    "Outdoor Balcony": SpaceType.Balcony,

    // Deck
    Deck: SpaceType.Deck,
    "Wood Deck": SpaceType.Deck,
    "Outdoor Deck": SpaceType.Deck,

    // Porch
    Porch: SpaceType.Deck,
    "Front Porch": SpaceType.Deck,
    "Back Porch": SpaceType.Deck,

    // Pool
    "Swimming Pool": SpaceType.Yard,
    Pool: SpaceType.Yard,

    // Driveway
    Driveway: SpaceType.Driveway,
    "Parking Area": SpaceType.Driveway,
    Walkway: SpaceType.Driveway,

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
    [SpaceType.DiningRoom]: {
      keywords: ["dining", "meal", "feast", "dinner", "lunch"],
      weight: 0.7,
    },
    [SpaceType.Office]: {
      keywords: ["work", "computer", "desk", "business", "study"],
      weight: 0.7,
    },
    [SpaceType.Garage]: {
      keywords: ["vehicle", "storage", "equipment", "tool", "mechanical"],
      weight: 0.7,
    },
    [SpaceType.Basement]: {
      keywords: ["underground", "lower", "storage", "basement"],
      weight: 0.6,
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
    [SpaceType.Attic]: {
      keywords: ["upper", "top", "roof", "storage", "insulation"],
      weight: 0.6,
    },
    [SpaceType.Laundry]: {
      keywords: ["wash", "clean", "utility", "detergent", "clothes"],
      weight: 0.7,
    },
    [SpaceType.Closet]: {
      keywords: ["storage", "clothes", "organize", "wardrobe"],
      weight: 0.6,
    },
    [SpaceType.Pantry]: {
      keywords: ["food", "storage", "shelf", "supply", "provision"],
      weight: 0.6,
    },
    [SpaceType.Mudroom]: {
      keywords: ["entry", "boots", "coat", "storage", "transition"],
      weight: 0.6,
    },
    [SpaceType.Foyer]: {
      keywords: ["entrance", "grand", "welcome", "entry", "formal"],
      weight: 0.6,
    },
    [SpaceType.Library]: {
      keywords: ["book", "read", "study", "literature", "shelf"],
      weight: 0.7,
    },
    [SpaceType.GameRoom]: {
      keywords: ["game", "play", "recreation", "fun", "entertainment"],
      weight: 0.7,
    },
    [SpaceType.HomeTheater]: {
      keywords: ["movie", "cinema", "screen", "theater", "media"],
      weight: 0.7,
    },
    [SpaceType.Gym]: {
      keywords: ["exercise", "fitness", "workout", "training", "equipment"],
      weight: 0.7,
    },
    [SpaceType.Studio]: {
      keywords: ["art", "music", "creative", "design", "craft"],
      weight: 0.6,
    },
    [SpaceType.GuestRoom]: {
      keywords: ["guest", "visitor", "spare", "accommodation"],
      weight: 0.6,
    },
    [SpaceType.MasterBedroom]: {
      keywords: ["master", "suite", "primary", "ensuite", "luxury"],
      weight: 0.7,
    },
    [SpaceType.Balcony]: {
      keywords: ["balcony", "outdoor", "view", "railing", "terrace"],
      weight: 0.6,
    },
    [SpaceType.Patio]: {
      keywords: ["outdoor", "seating", "entertainment", "barbecue", "dining"],
      weight: 0.6,
    },
    [SpaceType.Deck]: {
      keywords: ["wooden", "outdoor", "platform", "railing", "boards"],
      weight: 0.6,
    },
    [SpaceType.Yard]: {
      keywords: ["grass", "lawn", "garden", "outdoor", "landscaping"],
      weight: 0.7,
    },
    [SpaceType.Driveway]: {
      keywords: ["parking", "concrete", "asphalt", "entrance", "vehicle"],
      weight: 0.6,
    },
  };

  /**
   * Process detected labels to determine space type with enhanced matching
   */
  processLabels(labels: Label[]): ClassificationResult {
    // Track space type scores with improved weighting
    const spaceScores: Record<SpaceType, number> = {} as Record<
      SpaceType,
      number
    >;

    // Initialize all space types with 0 score
    Object.values(SpaceType).forEach((type) => {
      spaceScores[type] = 0;
    });

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
