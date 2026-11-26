// LongMemEval's own answer check: the type-specific prompts from the benchmark's evaluate_qa.py, word for word.
// The paper's judge is GPT-4o; here a Claude model reads the same prompts, so scores are comparable across
// our arms but not to published numbers.

import type { Question } from "./longmemeval.ts";
import type { ModelClient } from "./model.ts";
import { MAX_OUTPUT } from "./arms.ts";

export function judgePrompt(q: Question, response: string): string {
  if (q.abstention) {
    return `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: ${q.question}\n\nExplanation: ${q.answer}\n\nModel Response: ${response}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.`;
  }
  const base =
    "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.";
  const body = (label: string) => `\n\nQuestion: ${q.question}\n\n${label}: ${q.answer}\n\nModel Response: ${response}\n\n`;
  switch (q.type) {
    case "single-session-user":
    case "single-session-assistant":
    case "multi-session":
      return `${base} ${body("Correct Answer")}Is the model response correct? Answer yes or no only.`;
    case "temporal-reasoning":
      return `${base} In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. ${body("Correct Answer")}Is the model response correct? Answer yes or no only.`;
    case "knowledge-update":
      return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.${body("Correct Answer")}Is the model response correct? Answer yes or no only.`;
    case "single-session-preference":
      return `I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.${body("Rubric")}Is the model response correct? Answer yes or no only.`;
    default:
      throw new Error(`Unknown question type: ${q.type}`);
  }
}

/**
 * Stricter than the benchmark's script, which passes a "yes" anywhere (so "no, yesterday..." would pass):
 * the reply has to open with yes.
 */
export const passes = (judgeReply: string) => /^\W*yes\b/i.test(judgeReply);

export async function judge(model: ModelClient, judgeModel: string, q: Question, response: string) {
  const res = await model.complete({
    model: judgeModel,
    system: "You grade answers. Reply with yes or no only.",
    messages: [{ role: "user", content: judgePrompt(q, response) }],
    // Room for the judge's thinking: a judge cut off mid-thought is an error, not a verdict.
    maxTokens: MAX_OUTPUT,
    effort: "low",
    purpose: "judge",
  });
  return { pass: passes(res.text), reply: res.text, usage: res.usage, latencyMs: res.latencyMs };
}
