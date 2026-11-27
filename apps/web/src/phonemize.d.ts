/** Text to Kokoro phonemes. `language` "a" is American English, "b" British. */
export function phonemize(text: string, language?: "a" | "b", norm?: boolean): Promise<string>;
