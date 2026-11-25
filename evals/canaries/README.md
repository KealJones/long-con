# Canaries

A canary is a made-up but distinctive fact dropped into a real conversation on purpose, so recall can be checked against a known answer.

Each canary records:

| Field | Example |
| --- | --- |
| What was planted | A fake side project with a silly name and a pricing plan |
| Where | Which conversation and roughly when, mid-way through an unrelated topic |
| Expected sorting | Its own thread, kept apart from the topic around it |
| Expected recall | The exact distinctive phrase, when asked later |

Rules:

- Plant them silently. A canary announced in the same chat tests nothing.
- They only test recall of obviously new topics, so they complement the pain-mined set rather than replace it.
- The real list lives in `evals/data/canaries.json`, outside git. This repo is public, and a published canary stops being a canary.
