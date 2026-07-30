// MRI v3 — seller persona templates + fallback seeded listings.
//
// v3 does NOT use pre-seeded listings as the main path. They exist only as a
// fallback when the ScrapeCreators API fails during the demo, and the UI labels
// them with source "seeded_fallback".

import { Listing, SellerPersona } from "@/lib/types";

// --- Seller persona templates ----------------------------------------------
// Used to give simulated negotiations distinct, demonstrable behaviors. The
// `persona_from_listing` LLM mode produces these live; templates are the
// deterministic fallback and the source of the three demo archetypes.

export interface PersonaTemplate {
  name: string;
  style: string;
  concessionPattern: SellerPersona["concessionPattern"];
  hiddenInfo: string;
}

export const personaTemplates: PersonaTemplate[] = [
  {
    name: "Mike",
    style: "friendly and responsive",
    concessionPattern: "easy_drop",
    hiddenInfo: "has another buyer interested but prefers a quick pickup",
  },
  {
    name: "Sarah",
    style: "firm on price but willing to include extras",
    concessionPattern: "firm_price",
    hiddenInfo:
      "can include a case and extra charging cable if buyer does not push too hard on price",
  },
  {
    name: "Dave",
    style: "brief and slightly evasive",
    concessionPattern: "condition_issue",
    hiddenInfo: "the phone had a screen replacement after a drop, revealed only when asked directly",
  },
  {
    name: "Jen",
    style: "slow replies but honest",
    concessionPattern: "slow_reply",
    hiddenInfo: "available only on Sunday afternoon",
  },
];

// Scammy persona — used to demo scam detection. Triggers pattern-based flags.
export const scamPersonaTemplate: PersonaTemplate = {
  name: "Rick",
  style: "pushy and evasive, tries to move off-platform and demands upfront payment",
  concessionPattern: "easy_drop",
  hiddenInfo: "will ask buyer to pay via Venmo before meeting and refuses inspection",
};

// Price floor multiplier per concession pattern — how low this seller will go.
const FLOOR_MULTIPLIER: Record<SellerPersona["concessionPattern"], number> = {
  easy_drop: 0.7,
  firm_price: 0.92,
  condition_issue: 0.78,
  slow_reply: 0.85,
};

// Build a deterministic SellerPersona from a listing using rotating templates.
// `index` keeps the three demo lanes distinct (easy / firm / scam detected).
// Index 2 always gets the scam persona so the demo showcases scam detection.
export function personaFromTemplate(listing: Listing, index = 0): SellerPersona {
  const template = index === 2
    ? scamPersonaTemplate
    : personaTemplates[index % personaTemplates.length];
  const floor = Math.max(Math.round(listing.price * FLOOR_MULTIPLIER[template.concessionPattern]), 5);
  return {
    name: template.name,
    style: template.style,
    priceFloor: Math.min(floor, listing.price),
    hiddenInfo: template.hiddenInfo,
    concessionPattern: template.concessionPattern,
  };
}

// Back-compat alias for the frontend (app/page.tsx). Same behavior as
// personaFromTemplate; `index` is optional and derived from the listing id.
export function getSellerPersona(listing: Listing, index?: number): SellerPersona {
  const resolvedIndex =
    index ?? (Number.isFinite(parseInt(listing.id, 10)) ? parseInt(listing.id, 10) - 1 : 0);
  return personaFromTemplate(listing, Math.max(0, resolvedIndex));
}

// --- Fallback seeded listings ----------------------------------------------
// iPhone listings for the demo, reshaped into the v3 Listing model.
// Marked source "seeded_fallback" so the UI can badge them clearly.

function seeded(
  partial: Omit<Listing, "images" | "link" | "condition"> &
    Partial<Pick<Listing, "images" | "link" | "condition">>
): Listing {
  return {
    condition: "",
    ...partial,
    images: partial.images ?? (partial.image ? [partial.image] : []),
    link: partial.link ?? partial.url ?? "",
  };
}

export const fallbackListings: Listing[] = [
  seeded({
    id: "fallback-1",
    url: "https://www.facebook.com/marketplace/item/949813030755462/",
    title: "iPhone 15 Pro 128GB Natural Titanium",
    price: 750,
    fairValue: 850,
    condition: "Used - Like New",
    specs: "iPhone 15 Pro, 128GB, Natural Titanium, A17 Pro chip, 48MP camera, USB-C, unlocked",
    image:
      "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-1inch-naturaltitanium",
    sellerName: "Marketplace Seller",
    distance: "6 mi away",
    location: "Oakland, CA",
    listingDateText: "3 days ago",
    availabilityText: "available",
    description:
      "iPhone 15 Pro 128GB in Natural Titanium. Unlocked, works on all carriers. Always had a case and screen protector. Battery health 96%. Comes with original box and USB-C cable. Local pickup Oakland.",
    source: "seeded_fallback",
    riskFlags: [],
  }),
  seeded({
    id: "fallback-2",
    url: "https://www.facebook.com/marketplace/item/1503580751149128/",
    title: "iPhone 14 Pro Max 256GB Deep Purple",
    price: 620,
    fairValue: 700,
    condition: "Good (minor scratch)",
    specs: "iPhone 14 Pro Max, 256GB, Deep Purple, A16 Bionic, 48MP camera, Lightning, unlocked",
    image:
      "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-14-pro-finish-select-202209-6-7inch-deeppurple",
    sellerName: "Marketplace Seller",
    distance: "9 mi away",
    location: "San Francisco, CA",
    listingDateText: "5 days ago",
    availabilityText: "available",
    description:
      "iPhone 14 Pro Max 256GB Deep Purple. Unlocked. Small scratch on the back glass, barely visible with a case. Screen is perfect. Battery health 89%. Charger not included.",
    source: "seeded_fallback",
    riskFlags: ["minor scratch on back glass", "battery health 89%"],
  }),
  seeded({
    id: "fallback-3",
    url: "https://www.facebook.com/marketplace/item/2002892227106263/",
    title: "iPhone 15 Pro Max 256GB Black Titanium",
    price: 850,
    fairValue: 950,
    condition: "Used - Fair",
    specs: "iPhone 15 Pro Max, 256GB, Black Titanium, A17 Pro chip, 48MP camera, USB-C, unlocked",
    image:
      "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-max-finish-select-202309-6-7inch-blacktitanium",
    sellerName: "Marketplace Seller",
    distance: "12 mi away",
    location: "San Jose, CA",
    listingDateText: "2 days ago",
    availabilityText: "available",
    description:
      "iPhone 15 Pro Max 256GB Black Titanium. Unlocked. Screen replaced at Apple Store (receipt available). Cash only. No price change.",
    source: "seeded_fallback",
    riskFlags: ["seller states no price change", "screen was replaced"],
  }),
  seeded({
    id: "fallback-4",
    url: "https://www.facebook.com/marketplace/item/819371031217917/",
    title: "iPhone 15 128GB Blue",
    price: 520,
    fairValue: 600,
    condition: "Used - Good",
    specs: "iPhone 15, 128GB, Blue, A16 Bionic, 48MP camera, USB-C, unlocked",
    image:
      "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-finish-select-202309-6-1inch-blue",
    sellerName: "Marketplace Seller",
    distance: "8 mi away",
    location: "San Francisco, CA",
    listingDateText: "1 day ago",
    availabilityText: "available",
    description:
      "iPhone 15 128GB Blue in good working condition. Unlocked, battery health 93%. Comes with a MagSafe case and USB-C cable. No scratches on screen. $520 OBO.",
    source: "seeded_fallback",
    riskFlags: [],
  }),
  seeded({
    id: "fallback-5",
    url: "https://www.facebook.com/marketplace/item/1749614599345484/",
    title: "iPhone 16 Pro Max 512GB Desert Titanium",
    price: 1100,
    fairValue: 1250,
    condition: "Used - Like New",
    specs: "iPhone 16 Pro Max, 512GB, Desert Titanium, A18 Pro chip, 48MP camera, USB-C, unlocked",
    image:
      "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-16-pro-max-finish-select-202409-6-9inch-deserttitanium",
    sellerName: "Marketplace Seller",
    distance: "15 mi away",
    location: "San Francisco, CA",
    listingDateText: "1 week ago",
    availabilityText: "available",
    description:
      "iPhone 16 Pro Max 512GB Desert Titanium. Mint condition, barely used. Unlocked. Battery health 100%. Includes original box, cable, and AppleCare+ until March 2027.",
    source: "seeded_fallback",
    riskFlags: [],
  }),
];

// Back-compat alias for the frontend (app/page.tsx uses `demoListings`).
export const demoListings: Listing[] = fallbackListings;
