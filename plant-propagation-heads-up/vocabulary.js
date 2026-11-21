// Final AGPS-01 Week 14 vocabulary bank.
// Add or replace quoted terms within the matching category. Keep terms unique
// (case-insensitive) and keep at least eight in each of the six categories.
const VOCABULARY = {
  "Seed propagation and germination": [
    "Seed coat", "Embryo", "Cotyledon", "Endosperm", "Germination",
    "Imbibition", "Radicle", "Seed dormancy", "Stratification",
    "Scarification", "Plant propagation"
  ],
  "Cuttings and adventitious rooting": [
    "Stem cutting", "Leaf cutting", "Node", "Internode",
    "Adventitious root", "Auxin", "Rooting medium", "Misting",
    "Softwood cutting", "Hardwood cutting", "Humidity dome", "Bottom heat",
    "Mother plant", "Tip cutting", "Perlite"
  ],
  "Division and separation": [
    "Division", "Separation", "Rhizome", "Stolon", "Bulb", "Corm",
    "Stem tuber", "Offset", "Crown", "Sucker", "Strawberry runner"
  ],
  "Layering": [
    "Simple layering", "Air layering", "Tip layering", "Mound layering",
    "Serpentine layering", "Trench layering", "Rooting while attached",
    "Wounding", "Sphagnum moss", "Root ball"
  ],
  "Grafting and budding": [
    "Scion", "Rootstock", "Cambium", "Graft union", "Graft compatibility",
    "Whip-and-tongue graft", "T-budding", "Grafting tape", "Grafting", "Budding"
  ],
  "Tissue culture": [
    "Micropropagation", "Explant", "Aseptic technique", "Culture medium",
    "Agar", "Contamination", "Callus", "Plantlet",
    "Acclimatization", "Surface sterilization", "Hardening off", "Synthetic seed"
  ]
};

// Familiar is the default. Add or remove an exact bank term here to change its
// difficulty. Keep its topic assignment above regardless of difficulty.
const CHALLENGING_TERMS = new Set([
  "Imbibition", "Stratification", "Scarification",
  "Adventitious root", "Auxin",
  "Corm", "Offset",
  "Serpentine layering", "Trench layering",
  "Graft compatibility", "Whip-and-tongue graft", "T-budding",
  "Explant", "Callus", "Acclimatization", "Surface sterilization", "Synthetic seed"
]);
