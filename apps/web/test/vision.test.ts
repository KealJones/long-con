import assert from "node:assert/strict";
import { test } from "node:test";
import { imageNote, imageTools, PROFILES } from "@long-con/core";
import { runAskImage, type AskImage } from "../src/vision.ts";

const images = new Map([["img-1", { ref: { id: "img-1", name: "dog.jpg" }, blob: new Blob(["x"]) }]]);

test("only models that can't see get ask_image", () => {
  assert.deepEqual(imageTools(PROFILES.claude), []);
  assert.deepEqual(imageTools(PROFILES.smallLocal).map((t) => t.name), ["ask_image"]);
  assert.equal(imageNote([]), "");
  assert.match(imageNote([images.get("img-1")!.ref]), /img-1 \(dog\.jpg\).*ask_image/);
});

test("ask_image passes the image and question to the vision model", async () => {
  const seen: [Blob, string][] = [];
  const ask = async (): Promise<AskImage> => async (blob, q) => (seen.push([blob, q]), " A brown dog. ");
  const out = await runAskImage({ image_id: "img-1", question: "What is it?" }, images, ask);
  assert.deepEqual(out, { text: "A brown dog.", isError: false });
  assert.equal(seen[0]![0], images.get("img-1")!.blob);
  assert.equal(seen[0]![1], "What is it?");
});

test("bad ids, missing questions and model failures come back as errors, not throws", async () => {
  const never = async (): Promise<AskImage> => assert.fail("should not load the model");
  assert.match((await runAskImage({ image_id: "nope", question: "?" }, images, never)).text, /No attached image.*img-1/);
  assert.equal((await runAskImage({ image_id: "img-1" }, images, never)).isError, true);
  const broken = async (): Promise<AskImage> => { throw new Error("out of memory"); };
  assert.deepEqual(await runAskImage({ image_id: "img-1", question: "?" }, images, broken), { text: "The vision model failed: out of memory", isError: true });
});
