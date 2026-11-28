// Attachments in the browser: shrink images before they're sent, and keep files in IndexedDB (too big for localStorage).

import type { Attachment } from "./chat.ts";

/** The longest side the model gets; bigger images cost more and aren't seen better. */
const MAX_SIDE = 1568;
const MAX_PDF = 20 * 1024 * 1024;

export const toBase64 = (buf: ArrayBuffer | Uint8Array) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** A picked or pasted file, ready to send: images scaled down to JPEG, PDFs as they are. */
export async function prepare(file: File): Promise<Attachment> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF) throw new Error(`${file.name} is over 20 MB.`);
    return { name: file.name, type: file.type, data: toBase64(await file.arrayBuffer()) };
  }
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} isn't an image or a PDF.`);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // JPEG has no transparency; white beats black behind a screenshot.
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't read that image."))), "image/jpeg", 0.85));
  const name = (file.name && file.name !== "image.png" ? file.name : `pasted-${Date.now()}.png`).replace(/\.\w+$/, "") + ".jpg";
  return { name, type: "image/jpeg", data: toBase64(await blob.arrayBuffer()) };
}

export const dataUrl = (a: Attachment) => `data:${a.type};base64,${a.data}`;

// ── IndexedDB: one store, keyed like the packets ("<day>#<turn>", or "<thread id>#<turn>") ──

let db: Promise<IDBDatabase> | null = null;
const open = () =>
  (db ??= new Promise((ok, fail) => {
    const req = indexedDB.open("long-con", 1); // database name kept so attachments saved before the rename stay
    req.onupgradeneeded = () => req.result.createObjectStore("attachments");
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  }));

const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const store = (await open()).transaction("attachments", mode).objectStore("attachments");
  return new Promise((ok, fail) => {
    const req = fn(store);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
};

export const saveFiles = (key: string, files: Attachment[]) => run("readwrite", (s) => s.put(files, key));
export const loadFiles = (key: string) => run<Attachment[] | undefined>("readonly", (s) => s.get(key));
export const clearFiles = () => run("readwrite", (s) => s.clear());
