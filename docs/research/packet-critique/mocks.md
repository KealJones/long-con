# Mocked packet forms (written by hand from docs/plan.md and docs/architecture.md)

The builder does not produce these sections yet: a notes register, open loops, Q→A answers, and per-item source/why labels beyond "matched <words>". These mocks follow the plan's descriptions as closely as possible so the design can be critiqued anyway. The wording of section headers is a guess where the plan doesn't fix it.

## M1 Full-form packet — claude profile (ceiling 8000), message "ok go ahead and check those fares, and remind me what we said about the hike"

```text
Earlier chat history (since 2026/10/02 (Fri) 21:14) was left out to fit. The search_history tool can reach all of it.
This packet is a best guess at what's relevant. Don't rely on anything in it that looks wrong; use the tools instead.

Standing rules from the user, word for word:
- "from now on always write typescript, never suggest python for it" (tilde repo, said 2026/10/02)
- "remember to keep deps at zero if you can" (tilde repo, said 2026/10/02)

Notes:
- User's son Dash is 7 and gets carsick on planes. (source: user, 2026/11/10 and 2026/11/25 · confidence 0.9)
- Family is driving Phoenix → San Diego for Thanksgiving, leaving Wednesday before 6am. (source: chat 2026/11/10 · confidence 0.8)

Open loops (offers you made that the user hasn't answered):
- "Want me to check fares for the Wednesday before?" (you offered 2026/11/10 · still open · why: user said "go ahead")

Reference resolved: "those fares" read as the open loop above (Southwest fares, Wednesday before Thanksgiving).

Latest results you gave: $1,740 (rent share, 2026/10/20), $20,880 (rent per year, 2026/10/20)

Your latest answers, so you stay consistent:
- Then Torrey Pines is the best fit: short, flat, and the beach is at the bottom. (2026/11/25)

Earlier questions and their answers:
- Q: "whats the cheapest way to get from phoenix to san diego for thanksgiving" → A: drive (~5h, ~$48 gas each way); Southwest ~$129 each; Amtrak ~9h, $62 each. (2026/11/10 · confidence 0.92 · why: matched "fares")
- Q: "give me a few [hikes near san diego]" → A: Cowles Mountain, Torrey Pines, Potato Chip Rock; picked Torrey Pines for Dash. (2026/11/25 · confidence 0.88 · why: matched "hike")

Retrieved history, oldest first:
### 2026/11/10 (Tue) 09:30 · confidence 0.92 · source: chat · why: matched "fares", open loop
user: whats the cheapest way to get from phoenix to san diego for thanksgiving, me emmy and dash
assistant: Three options:
1. Drive: about 5 hours, roughly $48 in gas each way for the car.
2. Fly Southwest: about $129 each, so around $390 each way for three.
3. Amtrak: about 9 hours with a bus connection, $62 each.
Want me to check fares for the Wednesday before?
user: driving prob, dash gets carsick on planes anyway
assistant: Driving makes sense. Leave before 6am Wednesday to beat the I-8 traffic, and stop in Yuma for a break.
```

## M1 Full-form packet — small-local profile (ceiling 2500), same message

```text
Earlier chat history was left out. search_history can reach it.
Best guess; if something looks wrong, use the tools.

Rules (user's words):
- "always write typescript, never suggest python" (tilde repo)
- "keep deps at zero if you can" (tilde repo)

Notes:
- Dash is 7, carsick on planes.
- Driving to San Diego for Thanksgiving, Wednesday before 6am.

Open loop: you offered "check fares for the Wednesday before" (2026/11/10). User now says go ahead.

"those fares" = Southwest fares, Wednesday before Thanksgiving.

Q→A:
- Cheapest way PHX→SD: drive ~$48 gas each way; Southwest ~$129 each; Amtrak $62 each. (2026/11/10)
- Hikes: picked Torrey Pines for Dash. (2026/11/25)
```

## M2 Per-item confidence/source/date/why on a knowledge-update question — claude profile, mocked from the LME 18bc8abd packet

```text
Earlier chat history (since 2023/03/18 (Sat) 01:27) was left out to fit. The search_history tool can reach all of it.
This packet is a best guess at what's relevant. Don't rely on anything in it that looks wrong; use the tools instead.
Today is 2023/07/15 (Sat).

Notes:
- Currently obsessed with Kansas City Masterpiece BBQ sauce. (source: user, 2023/06/30 · confidence 0.85 · supersedes: Sweet Baby Ray's, 2023/04/16)

Retrieved history, oldest first:
### 2023/04/16 (Sun) 02:28 · confidence 0.57 · source: chat · why: matched "bbq sauce" · superseded by 2023/06/30
user: ... I've been loving Sweet Baby Ray's lately ...
### 2023/06/30 (Fri) 05:15 · confidence 1.0 · source: chat · why: matched "bbq sauce", "currently"
user: ... I'm currently obsessed with Kansas City Masterpiece ...
```

## M3 Empty packet — the plan's gate working as designed (message "thanks!!")

```text
Earlier chat history was left out to fit. The search_history tool can reach all of it.
```
