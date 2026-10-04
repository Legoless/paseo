declare module "markdown-it/lib/rules_block/reference" {
  import type MarkdownIt from "markdown-it";

  const reference: Parameters<MarkdownIt["block"]["ruler"]["at"]>[1];
  export default reference;
}
