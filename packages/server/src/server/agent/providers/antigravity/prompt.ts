import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentPromptContentBlock, AgentPromptInput } from "../../agent-sdk-types.js";
import { renderPromptAttachmentAsText } from "../../prompt-attachments.js";

export interface AgyPreparedPrompt {
  text: string;
  imagePaths: string[];
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function buildAgyUserPrompt(prompt: AgentPromptInput, imageDir?: string): AgyPreparedPrompt {
  if (typeof prompt === "string") {
    return { text: prompt, imagePaths: [] };
  }

  const parts: string[] = [];
  const imagePaths: string[] = [];
  let imageIndex = 0;

  for (const block of prompt) {
    if (block.type === "text") {
      if (block.text.length > 0) parts.push(block.text);
      continue;
    }
    if (block.type === "image") {
      if (!imageDir) {
        throw new Error("Antigravity image prompts require a session image directory");
      }
      imageIndex += 1;
      const path = writeAgyImageFile(imageDir, imageIndex, block);
      imagePaths.push(path);
      parts.push(`Attached image written to ${path}. Read it with view_file.`);
      continue;
    }
    const rendered = renderPromptAttachmentAsText(block);
    if (rendered.length > 0) parts.push(rendered);
  }

  return { text: parts.join("\n\n"), imagePaths };
}

function writeAgyImageFile(
  imageDir: string,
  index: number,
  block: Extract<AgentPromptContentBlock, { type: "image" }>,
): string {
  mkdirSync(imageDir, { recursive: true });
  const extension = IMAGE_EXTENSIONS[block.mimeType] ?? "bin";
  const path = join(imageDir, `attachment-${index}.${extension}`);
  writeFileSync(path, Buffer.from(block.data, "base64"));
  return path;
}
