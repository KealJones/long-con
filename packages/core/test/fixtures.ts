// Chats written the way people actually type: run-ons, slang, typos, topic jumps.
import type { Session } from "../src/index.ts";

export const filler: Session[] = [
  {
    id: "pasta",
    date: "2026/03/02 (Mon) 19:10",
    turns: [
      { role: "user", content: "ok so i have like half a box of rigatoni, some sausage and a sad looking zucchini, what do i make" },
      { role: "assistant", content: "Brown the sausage, add the zucchini in half-moons, toss with the rigatoni and a splash of pasta water. Parmesan on top." },
      { role: "user", content: "no cream?" },
      { role: "assistant", content: "Cream works too. A few tablespoons once the sausage is browned makes it richer." },
    ],
  },
  {
    id: "flights",
    date: "2026/03/05 (Thu) 08:41",
    turns: [
      { role: "user", content: "whats the cheapest way to get from phoenix to san diego, driving or flying" },
      { role: "assistant", content: "Driving is about 5 hours and usually cheaper for one person once you count bags and getting to the airport." },
      { role: "user", content: "gas is like 4 bucks tho" },
      { role: "assistant", content: "At 30 mpg that's roughly 360 miles, 12 gallons, about $48 each way." },
    ],
  },
  {
    id: "css",
    date: "2026/03/09 (Mon) 14:02",
    turns: [
      { role: "user", content: "why does my flexbox thing keep overflowing on mobile, the cards just shoot off the side" },
      { role: "assistant", content: "Give the cards min-width: 0 and let them wrap with flex-wrap: wrap. Long words also need overflow-wrap: anywhere." },
    ],
  },
  {
    id: "garden",
    date: "2026/03/14 (Sat) 10:30",
    turns: [
      { role: "user", content: "can tomatoes survive phoenix summer or am i wasting my time" },
      { role: "assistant", content: "Plant in February for a spring crop. By June most varieties stop setting fruit above 95F. Shade cloth helps." },
    ],
  },
];
