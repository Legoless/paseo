export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * The daemon reports a gone agent as `Agent not found: <id>`. There is no error code on the wire,
 * so the message shape is the classifier.
 */
export function isNotFoundErrorMessage(message: string): boolean {
  return /agent not found|not found/i.test(message);
}
