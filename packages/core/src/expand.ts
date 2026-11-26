// Query expansion inside tally mode. A counting question names a category ("how many siblings"), while the chats name
// its members ("my 3 sisters"). Each category word in the query also matches its members here, at a lower weight
// (see Bm25.search), so a member never outscores the word the user actually asked about.
//
// The table was written by hand from everyday categories people count (family, pets, things owned, media, events,
// food, health, fitness), not from any benchmark question, answer or evidence turn. Members are common, unambiguous
// kinds of the category; open-ended categories (hobbies, countries, games) are left out because their members can't
// be listed. Words are stemmed with the profile's stemmer at lookup time, so plural and singular both match.

import { contentWords, type Stemmer } from "./text.ts";

const TABLE: Record<string, string> = {
  sibling: "brother sister twin",
  family: "mom dad mother father brother sister son daughter wife husband grandma grandpa",
  relative: "aunt uncle cousin niece nephew grandma grandpa grandmother grandfather",
  parent: "mom dad mother father",
  kid: "son daughter",
  child: "son daughter",
  grandchild: "grandson granddaughter",
  pet: "dog cat puppy kitten hamster rabbit bunny parrot bird fish turtle",
  instrument: "guitar piano violin drum ukulele cello flute saxophone keyboard trumpet bass",
  album: "ep lp record mixtape vinyl",
  song: "track single",
  book: "novel memoir biography audiobook ebook paperback hardcover",
  movie: "film documentary",
  film: "movie documentary",
  show: "series sitcom documentary",
  podcast: "episode",
  photo: "picture photograph selfie",
  sport: "soccer football basketball tennis baseball volleyball golf hockey swimming cycling",
  workout: "yoga pilates run spin hiit cardio lifting",
  exercise: "yoga pilates run spin hiit cardio lifting",
  class: "lesson course workshop seminar lecture",
  course: "class lesson workshop seminar lecture",
  event: "concert festival wedding party conference meetup exhibition workshop",
  concert: "gig show festival performance",
  party: "celebration birthday shower gathering barbecue",
  trip: "vacation getaway holiday journey",
  vacation: "trip getaway holiday",
  device: "phone laptop tablet smartwatch headphones earbuds camera speaker console",
  gadget: "phone laptop tablet smartwatch headphones earbuds camera speaker console",
  electronics: "phone laptop tablet smartwatch headphones earbuds camera speaker console tv",
  appliance: "fridge refrigerator oven microwave dishwasher washer dryer blender toaster vacuum kettle",
  furniture: "sofa couch chair table desk bed dresser bookshelf cabinet wardrobe",
  vehicle: "car truck bike bicycle motorcycle scooter van suv",
  car: "sedan suv truck van hatchback",
  clothing: "shirt pants jeans dress jacket coat sweater skirt shorts hoodie blouse",
  clothes: "shirt pants jeans dress jacket coat sweater skirt shorts hoodie blouse",
  shoe: "sneaker boot sandal heel loafer slipper",
  jewelry: "ring necklace bracelet earring pendant",
  accessory: "bag belt hat scarf sunglasses wallet watch",
  plant: "succulent cactus fern orchid herb flower tree shrub",
  flower: "rose tulip lily daisy sunflower orchid",
  fruit: "apple banana orange strawberry grape mango berry peach pear lemon",
  vegetable: "carrot broccoli spinach tomato potato onion pepper lettuce kale zucchini",
  drink: "coffee tea juice soda beer wine smoothie latte cocktail",
  beverage: "coffee tea juice soda beer wine smoothie latte cocktail",
  meal: "breakfast lunch dinner brunch",
  dessert: "cake cookie pie brownie cupcake pudding",
  doctor: "physician dentist therapist dermatologist specialist pediatrician optometrist",
  appointment: "checkup visit consultation",
  medication: "pill prescription vitamin supplement",
  supplement: "vitamin probiotic",
  language: "spanish french german italian japanese chinese mandarin korean portuguese",
  art: "painting drawing sketch sculpture print",
  tool: "hammer drill saw screwdriver wrench",
  restaurant: "cafe diner bistro eatery pizzeria",
  museum: "gallery exhibit exhibition",
  gift: "present",
  present: "gift",
  coworker: "colleague teammate",
  colleague: "coworker teammate",
};

const cache = new Map<Stemmer, Map<string, string[]>>();

/** Category word (stemmed) to its members (stemmed), for the profile's stemmer. */
function table(stemmer: Stemmer): Map<string, string[]> {
  let map = cache.get(stemmer);
  if (map) return map;
  map = new Map();
  // The suffix stemmer splits some singulars from their plurals ("sibling" -> "sibl", "siblings" -> "sibling"), so both forms go in.
  const forms = (words: string) => [...new Set(contentWords(words.replace(/\w+/g, "$& $&s"), stemmer))];
  for (const [key, members] of Object.entries(TABLE)) {
    const keys = forms(key);
    for (const k of keys) map.set(k, [...new Set([...(map.get(k) ?? []), ...forms(members)])].filter((m) => !keys.includes(m)));
  }
  cache.set(stemmer, map);
  return map;
}

/** Members of each category word in the query, leaving out words the query already has. Empty when none apply. */
export function expandQuery(query: string, stemmer: Stemmer = "suffix"): Map<string, string[]> {
  const words = new Set(contentWords(query, stemmer));
  const map = table(stemmer);
  const out = new Map<string, string[]>();
  for (const w of words) {
    const members = (map.get(w) ?? []).filter((m) => !words.has(m));
    if (members.length) out.set(w, members);
  }
  return out;
}
