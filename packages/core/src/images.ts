// Images for models that can't see. Models whose profile says vision: false get the ask_image tool and a line saying
// which images are attached; the front end answers the tool with a small vision model (apps/web/src/vision.ts).

import type { Profile } from "./profiles.ts";

/** An image attached to a turn. The front end keeps the bytes; core and the model only see the id. */
export interface ImageRef {
  id: string;
  /** The file name the user picked, when there is one. */
  name?: string;
}

export const ASK_IMAGE_TOOL = {
  name: "ask_image",
  description:
    "Ask a question about an image the user attached. You can't see images yourself, so this asks a small vision model and returns its answer as text. Ask one specific question at a time (\"What text is on the sign?\", \"What color is the car?\"); start with \"Describe this image.\" if you don't know what it shows. The vision model is small: it can miss details or be wrong, so don't treat its answer as certain.",
  input_schema: {
    type: "object",
    properties: {
      image_id: { type: "string", description: "The image's id, from the attached-image line in the message" },
      question: { type: "string", description: "What to ask about the image" },
    },
    required: ["image_id", "question"],
  },
} as const;

/** Image tools for this profile: none for a model that sees images itself. */
export const imageTools = (profile: Profile) => (profile.vision ? [] : [ASK_IMAGE_TOOL]);

/** The line added to a message with images, for a model that can't see them. Empty when there are none. */
export function imageNote(images: readonly ImageRef[]): string {
  if (!images.length) return "";
  const list = images.map((i) => (i.name ? `${i.id} (${i.name})` : i.id)).join(", ");
  return `[Attached ${images.length === 1 ? "image" : "images"}: ${list}. You can't see images; call ask_image to ask about them.]`;
}
