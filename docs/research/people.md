# People: what to remember, how to read them, how to keep in touch

Research for Long Con's people cards and interest notes (plan item P31). Deep pass on 2026-11-26. Nothing here is built. Four evidence files sit in [people/](people/), each with every source linked:

- [what-to-remember.md](people/what-to-remember.md): how assistants, salespeople, hotels and clinicians keep notes on people; how AI memory products decide what to keep; memory benchmarks and their failure modes; privacy, inference and creepiness.
- [personality-and-reading.md](people/personality-and-reading.md): every common personality framework with how well it holds up; how accurately people (and LLMs) read others; whether tailoring to personality works.
- [crm-patterns.md](people/crm-patterns.md): data models of Monica, Mesh (formerly Clay), Dex, folk, vCard, Google People, HubSpot and Salesforce; Dunbar layers and decay; storage patterns; a sketch schema.
- [sales.md](people/sales.md): cold calls, cold email, sales methods, relationship building, account management, each tagged by evidence type.

## Short answer

1. **The things worth remembering are the same in every profession that keeps notes on people:** what they like to be called, family names and dates, food and allergies, how they like to communicate, hobbies and teams, work role, what they're proud of, and what's owed between you. What they all leave out: labels, speculation and anything said in confidence.
2. **Personality frameworks are mostly not worth storing.** Big Five, HEXACO and attachment (as two dimensions) are real, but predict any one moment at only about r = .30. MBTI retypes about half of people within 5 weeks. DISC and Enneagram are weak. Love languages, learning styles and astrology are unsupported.
3. **Reading people is weak.** Brief observation carries modest signal (r ≈ .39). Lie detection is 54%. Faces don't reliably show emotions. An LLM prompted to read personality from text lands around r = .2 to .3, about stranger level, and is worse for some groups than others.
4. **Personal CRMs agree on a shape:** a log of dated interactions, a summary card on top, a separate list of open loops, aliases, and an optional keep-in-touch interval counted from the last contact. None of them has a research-backed default cadence.
5. **Most famous sales stats are vendor data.** The solid science is about relationships: ask follow-up questions, reach out unprompted, say specific thanks, and assume they liked you more than you think.
6. **The biggest risk for Long Con is not missing a preference but misusing one.** Memory benchmarks find that saved memories leak into unrelated answers (median 53%), make models agree more, and get recalled without the latest value being acted on. That makes "an empty packet beats a wrong one" the right rule for people notes too.

## 1. What is worth remembering

Across Harvey Mackay's 66-question customer profile, executive-assistant preference files, Ritz-Carlton's guest notes and clinical social histories, the same categories recur:

| Category | Example | Why it earns a place |
| --- | --- | --- |
| Name and how they like to be addressed | nickname, pronunciation | Used every time |
| Family and key dates | partner's and kids' names, birthday, anniversary | Most common personal follow-up |
| Food, drink, allergies | "no cilantro", allergy | Logistics, and a safety issue when wrong |
| Communication preferences | channel, length, bluntness, time of day | Cheapest tailoring with the best evidence (section 3) |
| Interests | teams, hobbies, current obsessions | Openers and gifts; go stale |
| Work | role, company, what they're working on | Context for asks and intros |
| What they're proud of or care about | a project, a cause | Mackay's "person behind the desk" |
| Open loops | promised intros, money owed, "ask how the move went" | The items that actually prompt action |

How the professionals handle it matters as much as what they collect:

- **Many capture, one commits.** Ritz-Carlton staff jot guest preferences on a pad, and one guest-recognition manager reviews them before they enter the system.
- **Gather at their comfort level** and add a little each time. Mackay: "30 is better than 20."
- **Keep labels and impressions out of the shared record.** Therapists keep their impressions in a separate, more protected file. When 22,959 patients read their own notes, 10.5% felt judged, mostly by errors, labels ("anxious", "elderly") and loaded verbs ("refused", "admits"). The test the authors suggest: would you accept this note if it were about you?
- **Guard it.** Mackay: "not office gossip." EA dossiers are kept "under lock and key."

### What AI memory products do, and where it goes wrong

ChatGPT, Claude and Gemini all let you see, edit and delete memories, and all say they avoid saving sensitive topics unless asked. In 2,050 real ChatGPT memories from 80 users' data exports, 96% were saved without the user asking, 14% were inferred and 4% had no support in the chat. Zep/Graphiti and Mem0's graph mode keep a changed fact as history with a validity end date instead of deleting it, which is the same "newest wins, old kept" design Long Con plans.

The benchmarks show what goes wrong:

| Benchmark | Finding | What it means for Long Con |
| --- | --- | --- |
| PrefEval (ICLR 2025) | Models follow a stated preference under 10% of the time after 10 turns. A reminder of the preference raises it to 0.45-0.98. | A one-line interest note in the packet can be worth a lot |
| PersonaMem (NeurIPS 2025) | Models recall how a preference changed (60-70%) but act on the latest value only 30-50% of the time | Put only the current value in the packet |
| LongMemEval | "Used to be X, now Y" is graded correct | Keeping history is fine as long as the new value leads |
| PersistBench | A memory leaks into an unrelated answer at a median 53%; memory-driven agreement at a median ~98% | Relevance gate before any note goes in |
| OP-Bench | Every memory system did worse than no memory on irrelevant use, agreement and repetition | The empty packet is a real baseline, not a formality |
| MIT field study | A condensed user profile was the biggest single driver of models agreeing more | Don't store the user's opinions as profile facts |

Preferences also change more than people expect. In the end-of-history studies (Science 2013, n > 19,000), people predicted their favorite food, music and best friend would hold steady over a decade, while people a decade older reported big changes. Broad interest areas (like vocational interests) are much more stable. So "my favorite" is a dated snapshot, while "I love building things" can be treated as long-lived.

## 2. Personality frameworks

| Framework | Verdict | The number that matters |
| --- | --- | --- |
| Big Five | Strong | ~87% of trait-outcome links replicated (smaller effects); stability plateaus ~.74 after 50 |
| HEXACO | Strong | Big Five plus Honesty-Humility, replicated across cultures |
| Attachment (anxiety, avoidance) | Strong as two dimensions, weak as "styles" | Its main researcher advises against sorting people into types |
| MBTI | Weak | About 50% get a different type on a 5-week retest; scores aren't bimodal; publisher says don't use for hiring |
| DISC | Weak | Reliable enough, no validity evidence; better explained as Big Five blends |
| Enneagram | Weak | Review of 104 samples: mixed; factor analyses don't find nine types |
| CliftonStrengths | Weak to moderate | Evidence is mostly Gallup's own |
| Love languages | Unsupported | 2024 review: none of 10 studies support the core claims |
| Learning styles | Pseudoscience as applied | Matching teaching to style doesn't improve learning (Pashler 2008) |
| Astrology | Pseudoscience | Astrologers matched charts to profiles at 34% vs 33% chance |

Even the strong ones predict one moment poorly: trait-to-behavior correlations rarely pass .30-.40. What is stable is the average of someone's behavior over many occasions, not any single act. So "Sam is usually blunt" is a fine note, and "Sam will be blunt in this message" is a guess. Type labels add nothing over the dimensions behind them.

## 3. Reading people

| Signal | Accuracy | Source |
| --- | --- | --- |
| Thin slices (seconds to minutes of behavior) | Mean r = .39 with outcomes | Ambady & Rosenthal 1992 |
| Strangers judging traits | Extraversion easy, neuroticism hard | Funder's Realistic Accuracy Model |
| Spotting lies | 54% (chance 50%) | Bond & DePaulo 2006, 24,483 judges |
| Micro-expression training | No better than fake training | Jordan et al. 2019 |
| Emotion from faces | Weak reliability, poor specificity | Barrett et al. 2019 |
| Facebook Likes model, large data | r = .56, beats friends (.49) | Youyou et al. 2015 |
| LLM zero-shot from posts | r ≈ .29, better for women and younger users | Peters & Matz 2024 |
| LLM zero-shot from interviews | r < .26, openness near zero | Zhu et al. 2026 |

Two more findings shape note-writing. The fundamental attribution error: people turn one situation-driven act into a trait ("was rude in this thread" becomes "is rude"). And the self-other knowledge asymmetry: people know their own inner states best, while others can read visible traits. Long Con only ever hears the user's account of other people, so it is a second-hand judge of them.

**Tailoring.** Matching messages to inferred personality sometimes increases persuasion (Matz 2017, 2024; Salvi 2025: 81% higher odds with only basic demographics) and sometimes doesn't (Hackenburg & Margetts 2024). Where it works, it is persuasion, which is the manipulation risk. The low-risk, well-supported kind of tailoring is following what the person said they want: length, tone, directness, format.

## 4. Personal CRM and organization patterns

| Tool | Shape worth copying |
| --- | --- |
| Monica (open source) | Contact with relationships, activities, "how you met", gifts, debts, important dates; all manual |
| Mesh (formerly Clay) | Contacts built from mail, calendar and social; reconnect interval counted from the last interaction it sees |
| Dex | Keep-in-touch = last interaction + frequency; separate from plain dated reminders |
| folk | Smart fields like "My last interaction"; reminders ignore interactions |
| vCard 4.0 | A fixed relation vocabulary (spouse, child, friend, colleague, kin, met...) |
| Google People API | Every field records its source; one person is a merge of several sources, with merge history kept |
| HubSpot | Three different "last contact" fields; merges can't be undone |
| Salesforce | Open activities (owed) split from activity history (done) |

Relationship science behind cadence:

- **Friendships fade without contact; family holds.** Over 18 months, friendships lost closeness when contact dropped, kin ties much less (Roberts & Dunbar 2011).
- **Dunbar's 5/15/50/150 layers are a shape, not a rule.** A 2021 re-analysis put the uncertainty at roughly 2 to 520.
- **Friends take time.** About 50 hours to casual friend, 90 to friend, 200+ to close friend (Hall 2019).
- **Weak ties matter.** A randomized LinkedIn experiment on 20 million people found moderately weak ties produced the most job moves.
- **Tie strength can't be computed from chat.** The best predictor in Gilbert & Karahalios 2009 was days since last contact, and the model failed for friendships that lived offline.

Storage patterns that recur: an append-only log with a regenerated summary card (event sourcing); facts that are expired, not deleted, with "when it was true" and "when we learned it" kept apart (Graphiti); provenance on every field (Google People); under-merging people with an alias list (Zep prefers two nodes over one wrong merge); and open loops kept apart from history.

## 5. Sales

The honest headline: almost every famous sales number comes from a company selling sales software or training, with no peer review. Gong's two cold-call opener studies even contradict each other about "Did I catch you at a bad time?".

**Worth knowing, ranked by evidence:**

1. **Ask follow-up questions,** balanced with your own disclosure. More questions, more liking (Huang et al. 2017, speed dates and chats).
2. **Reach out unprompted and thank people specifically.** Recipients value check-ins (Liu et al. 2022) and gratitude notes (Kumar & Epley 2018) more than senders expect, most of all from weak ties.
3. **Assume they liked you more than you think** and follow up anyway (the liking gap, Boothby et al. 2018).
4. **Build the relationship with the person, not the company.** A meta-analysis of 94 studies found person-level relationships drive results more than firm-level ones (Palmatier et al. 2006).
5. **Escalating, reciprocal self-disclosure** builds closeness fast (Aron's 36 questions).
6. **Repeat their key words back, subtly.** Waitstaff who repeated orders got bigger tips; mimicking negotiators closed more deals. Mimicry people notice backfires (2023 preregistered studies).
7. **Use what they told you, not what you inferred,** and don't hide what you know. Covert or inferred personalization backfires (Aguirre 2015; Kim, Barasz & John 2019).
8. **Answer inbound interest fast.** Contact odds drop about 100x between a 5-minute and a 30-minute callback (2007 MIT/InsideSales, vendor co-authored, inbound leads only).
9. **Explore the problem before pitching** and propose a next step instead of hard-closing big deals (SPIN: 35,000 observed calls, never peer-reviewed).
10. **Cold email:** under ~100 words, about their problem, an "interested?" ask rather than a meeting time, 1-3 follow-ups (vendor consensus; unsubscribes rise after the third).
11. **Cold call:** say who you are and why you're calling, ask permission, then listen (vendor data only).

Challenger, Sandler, MEDDIC and Gap Selling are useful checklists with practitioner-grade evidence. The Challenger study was sponsored by the firm that sold its training.

## 6. Privacy and ethics

- **Stated vs inferred is the line that matters.** Showing people why they got a personalized result helped when the data was something they stated and hurt when it was inferred (Kim, Barasz & John 2019). Inferences have the weakest legal protection today (Wachter & Mittelstadt).
- **Inference can make a plain fact sensitive.** The EU's top court held in 2022 (C-184/20) that data that indirectly reveals health, sexuality, religion and so on counts as sensitive. A partner's name or "switched to my new meds" can qualify.
- **Creepiness has three parts:** implied bad intent, use out of context, and unpredictability (Woźniak et al., CHI 2021). Each one maps to a design choice: purpose, context tags, and visible notes.
- **Control raises acceptance.** After a social network gave users more privacy control, they were nearly twice as likely to click personalized ads (Tucker 2014). Covert collection reverses personalization's benefit (Aguirre 2015).
- **Users turn memory off once they see it.** In one study 91% said they'd use chatbot memory before seeing it and 26% after; 22% specifically wanted no personalization on work topics.
- **Other people never consented.** Notes about people in the user's life should keep to names, relationships and logistics the user stated, and leave out their health, money and private matters unless the user asks.

## 7. Takeaways for Long Con, ranked

1. **Write only what the user said, with its source turn. Never store inferred traits, type labels or diagnoses.** Every strand of this research lands here: inference is stranger-level accurate, biased by group, and the main cause of creepiness. A self-description ("I'm an INTJ lol") is stored as the user's words, not as a fact.
2. **Put only the current value in the packet, dated, and pull history only when asked.** PersonaMem shows models act on the latest value only 30-50% of the time when they see history. PrefEval shows a short reminder line lifts preference-following from under 10% to 45-98%, which is the strongest evidence that interest notes are worth building.
3. **Gate every note on relevance to this turn, and let the default be nothing.** Leakage (median 53%) and memory-driven agreement are the commonest failures, and OP-Bench found memory worse than no memory on them.
4. **Split capture from commit.** This is where the research pushes back on "any expressed interest should trigger a memory." Auto-saving everything is exactly how ChatGPT ended up with 96% unasked, 14% inferred and 4% unsupported memories. Keep the trigger, but have it propose: a candidate becomes a note only on explicit wording ("my favorite", "switched to", "obsessed with"), on repetition across sessions, or when the user confirms. Everything else stays in the lossless log, where search can still find it. This matches Ritz-Carlton's pad-and-curator setup.
5. **Treat a "favorite" as a dated snapshot and broad interests as long-lived.** Show "as of" dates, and lower confidence on specific favorites that haven't come up in months.
6. **Keep open loops separate from history and give them priority in the packet.** Promises, intros, money owed and "ask how X went" are what CRMs, account managers and the reaching-out research all point to as the useful part.
7. **The log is the truth and the card is a regenerated cache.** Facts are appended and superseded, never edited in place, each with when it was said and when it stopped being true.
8. **Under-merge people.** Keep an alias list ("my buddy from work"), and record merges as a reversible event. Chat has no email address to dedup on.
9. **Track "last mentioned" and "last talked with" separately, and make keep-in-touch optional.** A family-or-friend flag is worth more than a Dunbar layer, since friendships fade and family doesn't. No computed tie-strength score.
10. **Make cards visible and editable, and mark when one was used.** Control and predictability are what separate caring from creepy.
11. **Tag notes with their context (work, home, hobby) and don't cross over unasked.**
12. **Hold third-party cards to stricter rules, and keep sensitive categories out of automatic writes.** Health, religion, politics, sexuality and money get saved only when the user explicitly asks.
13. **Don't store the user's opinions on contested questions as profile facts.** A condensed profile was the biggest driver of model agreement in the MIT field study.

### Evals this suggests

- **PrefEval** and **PersonaMem** as preference benchmarks next to LongMemEval's knowledge-update and single-session-preference questions.
- **PersistBench** and **OP-Bench** as harm tests: they measure exactly the leakage and agreement a bad people note causes, and fit the existing harm and should-be-empty metrics.
- A false-note rate for the interest noter: how often it saves something that wasn't real interest, scored against the capture-vs-commit rule above.

## Gaps

- Several numbers come from abstracts or summaries because full papers were paywalled or blocked: Lindenfors 2021 and Rajkumar 2022 (press releases), Fraley 2015, Aguirre 2015, Matz 2017 (Cambridge summary), the MBTI retest rate (Funder's textbook).
- The full Mackay 66 isn't public; about 12 items are confirmed.
- No source gives a validated test for telling a one-off remark from a lasting preference. Takeaway 4's rule is a synthesis to test, not a finding.
- Monica's database schema couldn't be opened; its fields come from its README, docs and site.
