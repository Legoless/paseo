import { z } from "zod";

/**
 * Custom commands are user-authored shortcuts served to the app by the daemon. They live in two
 * JSON files: a global `$PASEO_HOME/commands.json` and a per-project
 * `<project-root>/.paseo-neo/commands.json`. Each command is a titled snippet of text the app can
 * drop into an agent composer or a terminal, optionally submitted on insert.
 *
 * This is a FILE schema, not a wire schema: parsing is lenient (defaults filled, missing `id`
 * derived from the title) so the daemon and the app normalize the same way. The pure wire shape
 * the daemon puts on the socket is `CustomCommandWireSchema` — messages.ts can only compile
 * schemas without transforms, so the two stay separate.
 */

export const CustomCommandTargetSchema = z.enum(["agent", "terminal"]);
export type CustomCommandTarget = z.infer<typeof CustomCommandTargetSchema>;

/** Id derived from a title when the file omits one: lowercase, non-alphanumeric runs become a
 * single dash, edge dashes trimmed. May be empty when the title has no alphanumeric characters;
 * `parseCustomCommandsFile` rejects that case instead of emitting an empty id. */
function deriveCustomCommandId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** One entry in a commands file, as authored. Unknown keys are stripped, not kept. */
export const CustomCommandSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().min(1),
    text: z.string().min(1),
    target: CustomCommandTargetSchema.default("agent"),
    submit: z.boolean().default(true),
    /** App-side key combo (e.g. "Cmd+Shift+R"); the daemon treats it as opaque. */
    shortcut: z.string().min(1).optional(),
  })
  .transform((command) => ({
    ...command,
    id: command.id ?? deriveCustomCommandId(command.title),
  }));
export type CustomCommand = z.infer<typeof CustomCommandSchema>;

export const CustomCommandsFileSchema = z.object({
  commands: z.array(CustomCommandSchema),
});
export type CustomCommandsFile = z.infer<typeof CustomCommandsFileSchema>;

/**
 * The normalized command as it crosses the WebSocket: every default applied, `id` always present.
 * Declared separately from `CustomCommandSchema` because wire schemas must stay pure — no
 * `.transform()`, `.catch()`, or `.preprocess()` — for the zod-aot inbound compiler
 * (docs/protocol-validation.md).
 */
export const CustomCommandWireSchema: z.ZodType<CustomCommand> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
  // COMPAT(customCommandTarget): added in v0.9.2, remove after 2027-03-23. Apps from v0.9.2 run a
  // command in the tab it was started from and ignore `target`; older apps require it here.
  target: CustomCommandTargetSchema,
  submit: z.boolean(),
  shortcut: z.string().min(1).optional(),
});

export type ParseCustomCommandsFileResult =
  | { ok: true; data: CustomCommandsFile }
  | { ok: false; error: string };

/**
 * The whole gate for one commands file. Returns one display-ready message (`commands.0.title:
 * ...`) naming the first offending entry rather than throwing or partially succeeding — a file
 * that cannot be trusted is better absent than half-applied.
 */
export function parseCustomCommandsFile(value: unknown): ParseCustomCommandsFileResult {
  const parsed = CustomCommandsFileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "root";
    return { ok: false, error: `${where}: ${issue?.message ?? "is not a valid commands file"}` };
  }
  for (const [index, command] of parsed.data.commands.entries()) {
    if (command.id.length === 0) {
      return {
        ok: false,
        error: `commands.${index}: title "${command.title}" has no letters or numbers to derive an id from; add an "id"`,
      };
    }
  }
  return { ok: true, data: parsed.data };
}
