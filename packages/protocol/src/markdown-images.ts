export interface MarkdownImage {
  source: string;
  alt: string | null;
}

// `![alt](src)` embeds and `[text](src)` links. Backslash escapes are consumed as pairs so the
// `\]` and `\)` that provider image output writes into alt text and paths don't close early. An
// unescaped `[` ends the text, so an earlier stray bracket (`[0, 5)`) or a badge link wrapping an
// embed (`[![b](x)](y)`) cannot swallow the embed that follows it.
const MARKDOWN_IMAGE_PATTERN = /(!?)\[((?:\\[\s\S]|[^\][\\])*)]\((<[^>]+>|(?:\\.|[^)\\\n])+)\)/g;
// A plain link counts only when it points at an image file; embeds count whatever their source.
const IMAGE_FILE_TARGET = /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i;
// CommonMark: a backslash escapes any ASCII punctuation character.
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;

export function extractMarkdownImages(markdown: string): MarkdownImage[] {
  const images: MarkdownImage[] = [];
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const source = normalizeMarkdownImageSource(match[3] ?? "");
    if (!source || (!match[1] && !IMAGE_FILE_TARGET.test(source))) {
      continue;
    }
    const alt = unescapeMarkdown(match[2] ?? "").trim() || null;
    images.push({ source, alt });
  }
  return images;
}

function normalizeMarkdownImageSource(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return unescapeMarkdown(trimmed.slice(1, -1)).trim() || null;
  }
  const titleMatch = /^(.*?)(?:\s+(['"]).*?\2)?$/.exec(trimmed);
  return unescapeMarkdown(titleMatch?.[1]?.trim() ?? trimmed) || null;
}

function unescapeMarkdown(value: string): string {
  return value.replace(MARKDOWN_ESCAPE, "$1");
}
