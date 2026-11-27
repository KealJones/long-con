# P17 BM25F sweep (dev slice, free)

One BM25F index (Robertson, Zaragoza & Taylor 2004) with a user field and an assistant field, the user field weighted
`u` (assistant 1), per-field length normalization `bU` / `bA`, k1 1.2. Reproduce with
`node --experimental-strip-types evals/loop/bm25f-sweep.ts --variants off,3:0.75:0.5,...`. Variant `u:bU:bA` replaces
the two-ranking RRF: BM25F orders the units and sets their relative confidence. `:share` keeps today's relative
confidence (BM25F orders only). `:fuse` adds BM25F as a third RRF list. In every variant the minScore bar and the unit
gate see the same two-ranking features as main, so nothing was refit. `off` is main (826beb2) and reproduces its numbers.

Columns: all-evidence whole and with pointers counted as found, evidence turns (same pair), mean answerable packet
tokens, all-evidence by type (multi-session, temporal-reasoning, single-session-preference), false inclusions per prompt
with mean retrieved tokens per tier (1, 1t, 2, 3), empty rate per tier, answerable packets left empty, answerable
precision, and the first 16 hex of a SHA-256 over every dev and probe packet text.

| profile | variant | all-ev | +ptr | turns | +ptr | tokens | multi | temporal | pref | t1 FI (retr) | t1t FI (retr) | t2 FI (retr) | t3 FI (retr) | empty t1/t1t/t2/t3 | ans empty | precision | sha256 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| claude | off | 78.7 | 80.9 | 86.5 | 87.6 | 3949 | 54.5 | 76.9 | 66.7 | 7.09 (1700) | 4.99 (1217) | 9.52 (2299) | 7.17 (1521) | 46.1/72.8/46.0/55.3 | 2.1 | 11.4 | 96ab2fff4c5f36a9 |
| claude | 1:0.75:0.75 | 68.1 | 68.1 | 76.6 | 76.6 | 3891 | 54.5 | 69.2 | 33.3 | 6.12 (1579) | 3.97 (1068) | 8.22 (2161) | 6.04 (1354) | 46.1/72.8/46.0/55.3 | 2.1 | 10.9 | f300a849f8403858 |
| claude | 1.5:0.75:0.75 | 70.2 | 70.2 | 81.6 | 81.6 | 3887 | 54.5 | 69.2 | 33.3 | 6.44 (1646) | 4.24 (1130) | 8.50 (2210) | 6.32 (1406) | 46.1/72.8/46.0/55.3 | 2.1 | 11.6 | ea4a5af0159cf886 |
| claude | 2:0.75:0.75 | 70.2 | 70.2 | 81.6 | 81.6 | 3800 | 54.5 | 69.2 | 33.3 | 6.62 (1688) | 4.42 (1175) | 8.72 (2241) | 6.47 (1459) | 46.1/72.8/46.0/55.3 | 2.1 | 11.7 | cda4729f7985a219 |
| claude | 3:0.75:0.75 | 72.3 | 72.3 | 82.6 | 82.6 | 3704 | 54.5 | 69.2 | 33.3 | 6.82 (1725) | 4.59 (1213) | 9.06 (2301) | 6.60 (1488) | 46.1/72.8/46.0/55.3 | 2.1 | 12.1 | 1fd1644a40bac009 |
| claude | 3:0.75:0.75:share | 76.6 | 76.6 | 85.5 | 85.5 | 4005 | 54.5 | 76.9 | 33.3 | 6.98 (1763) | 4.85 (1263) | 9.60 (2422) | 7.13 (1597) | 46.1/72.8/46.0/55.3 | 2.1 | 11.4 | 1b7ead4c6f4f4562 |
| claude | 1:0.75:0.75:share | 74.5 | 74.5 | 81.6 | 81.6 | 3921 | 54.5 | 76.9 | 33.3 | 6.67 (1705) | 4.45 (1168) | 9.04 (2321) | 6.77 (1522) | 46.1/72.8/46.0/55.3 | 2.1 | 11.0 | f6dc4e5fcbbb6a66 |
| claude | 5:0.75:0.75 | 74.5 | 74.5 | 82.3 | 82.3 | 3516 | 54.5 | 69.2 | 66.7 | 6.91 (1731) | 4.63 (1208) | 9.22 (2331) | 6.74 (1527) | 46.1/72.8/46.0/55.3 | 2.1 | 12.3 | d34c03eadf23633b |
| claude | 3:0.75:1 | 42.6 | 42.6 | 58.3 | 58.3 | 3190 | 36.4 | 30.8 | 33.3 | 6.17 (1600) | 3.15 (868) | 7.90 (2088) | 4.49 (1050) | 47.8/78.7/48.0/61.7 | 6.4 | 10.1 | 6add713e58bb7b1c |
| claude | 3:0.5:1 | 42.6 | 42.6 | 58.3 | 58.3 | 3171 | 36.4 | 30.8 | 33.3 | 6.18 (1602) | 3.17 (874) | 7.88 (2083) | 4.49 (1049) | 47.8/78.7/48.0/61.7 | 6.4 | 10.1 | 942cf6f7b1196239 |
| claude | 3:0.3:0.75 | 74.5 | 74.5 | 82.3 | 82.3 | 3604 | 54.5 | 69.2 | 66.7 | 6.88 (1741) | 4.62 (1216) | 9.12 (2321) | 6.64 (1500) | 46.1/72.8/46.0/55.3 | 2.1 | 12.1 | 00715466affd93ae |
| claude | 3:0.75:0.5 | 76.6 | 76.6 | 84.4 | 84.4 | 3747 | 54.5 | 76.9 | 66.7 | 6.77 (1725) | 4.55 (1207) | 9.02 (2306) | 6.49 (1484) | 46.1/72.8/46.0/55.3 | 2.1 | 12.4 | 1d835359cdf834c7 |
| claude | 3:0.75:0.3 | 74.5 | 74.5 | 83.7 | 83.7 | 3847 | 54.5 | 69.2 | 66.7 | 6.73 (1723) | 4.52 (1206) | 8.96 (2301) | 6.55 (1505) | 46.1/72.8/46.0/55.3 | 2.1 | 12.0 | 334cf2da369298f3 |
| claude | 5:0.75:0.3 | 74.5 | 74.5 | 82.3 | 82.3 | 3663 | 54.5 | 69.2 | 66.7 | 6.87 (1739) | 4.61 (1214) | 9.00 (2315) | 6.60 (1510) | 46.1/72.8/46.0/55.3 | 2.1 | 12.1 | ab10d0ae9fcea194 |
| claude | 5:0.5:0.3 | 74.5 | 74.5 | 82.3 | 82.3 | 3565 | 54.5 | 69.2 | 66.7 | 6.90 (1743) | 4.60 (1210) | 9.02 (2317) | 6.57 (1495) | 46.1/72.8/46.0/55.3 | 2.1 | 12.4 | 0cdefe5eed7c860f |
| claude | 1:0.75:0.75:fuse | 78.7 | 78.7 | 86.5 | 86.5 | 4024 | 54.5 | 76.9 | 66.7 | 7.18 (1762) | 5.12 (1289) | 9.94 (2463) | 7.23 (1587) | 46.1/72.8/46.0/55.3 | 2.1 | 11.2 | 9417279d66d0c4fb |
| claude | 3:0.75:0.75:fuse | 78.7 | 78.7 | 86.5 | 86.5 | 4029 | 54.5 | 76.9 | 66.7 | 7.14 (1735) | 5.11 (1272) | 9.84 (2413) | 7.26 (1578) | 46.1/72.8/46.0/55.3 | 2.1 | 11.1 | 217bd9b3a6e441ae |
| claude | 5:0.75:0.75:fuse | 78.7 | 78.7 | 86.5 | 86.5 | 4010 | 54.5 | 76.9 | 66.7 | 7.13 (1724) | 5.08 (1263) | 9.78 (2398) | 7.21 (1568) | 46.1/72.8/46.0/55.3 | 2.1 | 11.2 | 623da67b42509026 |
| small-local | off | 66.0 | 66.0 | 72.2 | 72.2 | 1425 | 36.4 | 61.5 | 0.0 | 1.43 (392) | 0.21 (55) | 1.18 (309) | 1.00 (263) | 73.6/96.0/72.0/78.7 | 17.0 | 24.9 | d0795dad04132a1e |
| small-local | 1:0.75:0.75 | 46.8 | 46.8 | 56.9 | 56.9 | 1406 | 36.4 | 30.8 | 0.0 | 1.29 (376) | 0.16 (48) | 1.02 (284) | 0.85 (229) | 73.8/96.0/74.0/78.7 | 17.0 | 22.3 | 79abfe0eec5f8c2d |
| small-local | 1.5:0.75:0.75 | 48.9 | 48.9 | 59.0 | 59.0 | 1401 | 36.4 | 38.5 | 0.0 | 1.34 (385) | 0.18 (51) | 1.06 (288) | 0.89 (237) | 73.6/96.0/74.0/78.7 | 17.0 | 23.9 | f2bc0e170d25835d |
| small-local | 2:0.75:0.75 | 53.2 | 53.2 | 62.9 | 62.9 | 1413 | 36.4 | 46.2 | 0.0 | 1.36 (389) | 0.19 (53) | 1.08 (289) | 0.94 (248) | 73.6/96.0/74.0/78.7 | 17.0 | 24.7 | a2387e67e1b4b6fb |
| small-local | 3:0.75:0.75 | 57.4 | 57.4 | 67.2 | 67.2 | 1411 | 36.4 | 46.2 | 0.0 | 1.38 (390) | 0.20 (55) | 1.14 (305) | 0.94 (251) | 73.6/96.0/72.0/78.7 | 17.0 | 25.3 | b692b64e152fcb67 |
| small-local | 3:0.75:0.5 | 57.4 | 57.4 | 66.5 | 66.5 | 1409 | 36.4 | 46.2 | 0.0 | 1.35 (390) | 0.20 (55) | 1.14 (305) | 0.96 (254) | 73.6/96.0/72.0/78.7 | 17.0 | 25.1 | 6ebf38952fb42ac6 |
| small-local | 3:0.75:0.3 | 55.3 | 55.3 | 64.4 | 64.4 | 1416 | 36.4 | 46.2 | 0.0 | 1.34 (390) | 0.20 (55) | 1.14 (305) | 0.96 (255) | 73.6/96.0/72.0/78.7 | 17.0 | 24.8 | 46fbf89872365211 |
| small-local | 5:0.75:0.3 | 55.3 | 55.3 | 65.1 | 65.1 | 1392 | 36.4 | 46.2 | 0.0 | 1.35 (391) | 0.20 (55) | 1.14 (303) | 0.98 (261) | 73.6/96.0/72.0/78.7 | 17.0 | 25.3 | d2a7a4c504f0e025 |
| small-local | 5:0.5:0.3 | 55.3 | 55.3 | 65.1 | 65.1 | 1387 | 36.4 | 46.2 | 0.0 | 1.35 (392) | 0.20 (55) | 1.14 (303) | 0.98 (261) | 73.6/96.0/72.0/78.7 | 17.0 | 25.1 | 76bd1b9b13f18df3 |
| small-local | 1:0.75:0.75:fuse | 61.7 | 61.7 | 69.3 | 69.3 | 1428 | 36.4 | 53.8 | 0.0 | 1.41 (391) | 0.21 (55) | 1.18 (309) | 1.00 (263) | 73.6/96.0/72.0/78.7 | 17.0 | 24.6 | 6d2ffc2908e449c1 |
| small-local | 3:0.75:0.75:fuse | 63.8 | 63.8 | 70.0 | 70.0 | 1422 | 36.4 | 61.5 | 0.0 | 1.41 (391) | 0.21 (55) | 1.18 (309) | 1.00 (263) | 73.6/96.0/72.0/78.7 | 17.0 | 24.8 | 3b536e685909ddaf |
| small-local | 5:0.75:0.75:fuse | 63.8 | 63.8 | 70.0 | 70.0 | 1421 | 36.4 | 61.5 | 0.0 | 1.42 (391) | 0.21 (55) | 1.18 (309) | 1.00 (263) | 73.6/96.0/72.0/78.7 | 17.0 | 24.8 | 85eed103afeb4bc8 |

No setting beats `off` on either profile. Replacing the fusion loses 1 to 5 claude questions whole (17 at bA 1.0) and the pointer-only
find; small-local loses 4 to 9. bA 1.0 collapses recall (short assistant fields get inflated). Adding BM25F as a third
list holds claude's whole recall but adds tokens and false inclusions on every tier and drops the pointer-only find (the
3-pointer cap is order-sensitive: one knowledge-update question's evidence pointer is pushed out by other medium units);
small-local loses a question. BM25F sums field frequencies before one saturation, so a unit whose long assistant answer
repeats the query words saturates without help from the user turn; RRF gives the user-words ranking its own vote, which
is what finds LongMemEval's user-turn evidence.
