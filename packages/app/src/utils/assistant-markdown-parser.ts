import type MarkdownIt from "markdown-it";
import { createMarkdownParser } from "@/utils/markdown-parser";
import { enableStreamingMarkdown } from "@/utils/streaming-markdown";

function createAssistantMarkdownParser({ streaming = false } = {}): MarkdownIt {
  const parser = createMarkdownParser({ linkify: true });
  const defaultValidateLink = parser.validateLink.bind(parser);

  // Assistant messages are the only surface allowed to link into the
  // filesystem. Every other parser keeps markdown-it's stricter default.
  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  if (streaming) {
    enableStreamingMarkdown(parser);
  }

  return parser;
}

// Shared by every assistant message: one parser with linkify compiled holds ~270 KB, so a
// parser per message let a restored timeline exhaust the desktop renderer's 4 GB V8 heap.
export const assistantMarkdownParser = createAssistantMarkdownParser();
export const streamingAssistantMarkdownParser = createAssistantMarkdownParser({ streaming: true });
