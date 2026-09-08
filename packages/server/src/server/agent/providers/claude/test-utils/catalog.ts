import { ClaudeAgentClient } from "../agent.js";
import { mapClaudeModels } from "../models.js";

// Session tests inject catalog facts independently of discovery, so their query
// factories model conversation processes only.
const fixtures = [
  { id: "default", fast: false, off: false },
  { id: "claude-opus-5", fast: true, off: true, context: 1_000_000 },
  { id: "claude-fable-5", fast: false, off: false, context: 1_000_000 },
  { id: "claude-opus-4-8", fast: true, off: true, context: 200_000 },
  { id: "claude-opus-4-8[1m]", fast: true, off: true, context: 1_000_000 },
  { id: "claude-opus-4-7", fast: true, off: true, context: 200_000 },
  { id: "claude-opus-4-7[1m]", fast: true, off: true, context: 1_000_000 },
  { id: "claude-opus-4-6", fast: true, off: true, context: 200_000 },
  { id: "claude-opus-4-6[1m]", fast: true, off: true, context: 1_000_000 },
  { id: "claude-sonnet-5", fast: false, off: true, context: 200_000 },
  { id: "claude-sonnet-5[1m]", fast: false, off: true, context: 1_000_000 },
  { id: "claude-sonnet-4-6", fast: false, off: true, context: 200_000 },
  { id: "claude-sonnet-4-6[1m]", fast: false, off: true, context: 1_000_000 },
  { id: "claude-haiku-4-5", fast: false, off: false, context: 200_000 },
];

export class TestClaudeAgentClient extends ClaudeAgentClient {
  constructor(options: ConstructorParameters<typeof ClaudeAgentClient>[0]) {
    super(options);
    this.setModelCatalog(
      fixtures.map((fixture) => {
        const model = mapClaudeModels([
          {
            value: fixture.id,
            displayName: fixture.id,
            description: "Runtime facts supplied by the session test",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
            supportsAdaptiveThinking: true,
            supportsFastMode: fixture.fast,
            supportsAutoMode: true,
          },
        ])[0]!;
        if (fixture.off) model.thinkingOptions?.unshift({ id: "off", label: "Off" });
        if (fixture.context) model.contextWindowMaxTokens = fixture.context;
        return model;
      }),
    );
  }
}
