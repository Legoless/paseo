/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 1.5: 6, 2: 8, 2.5: 10, 3: 12, 4: 16, 6: 24, 8: 32 },
    borderWidth: { 1: 1 },
    borderRadius: { sm: 4, md: 6, lg: 8, full: 9999 },
    fontSize: { xs: 11, sm: 13, base: 15, content: 15 },
    fontWeight: { normal: "400", medium: "500", semibold: "600" },
    fontFamily: { mono: "monospace" },
    iconSize: { sm: 14, md: 16, lg: 24 },
    opacity: { 50: 0.5 },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
      border: "#444",
      borderAccent: "#555",
      interactionHighlight: "rgba(255,255,255,0.08)",
      palette: { red: { 300: "#f87171" } },
    },
  },
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({
      uniProps,
      ...rest
    }: {
      uniProps?: (theme: unknown) => Record<string, unknown>;
    } & Record<string, unknown>) => {
      const themed = uniProps ? uniProps(theme) : {};
      return React.createElement(Component, { ...rest, ...themed });
    },
}));

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/attachments/use-attachment-preview-url", () => ({
  useAttachmentPreviewUrl: () => null,
}));
vi.mock("lucide-react-native", () => {
  const icon = (name: string) => {
    const Icon = () => React.createElement("span", { "data-icon": name });
    Icon.displayName = name;
    return Icon;
  };
  return {
    CircleDot: icon("CircleDot"),
    FileText: icon("FileText"),
    GitPullRequest: icon("GitPullRequest"),
    MessageSquareCode: icon("MessageSquareCode"),
    MousePointer2: icon("MousePointer2"),
    X: icon("X"),
  };
});

vi.mock("@/components/attachment-pill", () => ({
  AttachmentFrame: ({
    onPress,
    accessibilityLabel,
    testID,
    children,
  }: {
    onPress?: () => void;
    accessibilityLabel?: string;
    testID?: string;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick: onPress,
        "aria-label": accessibilityLabel,
        "data-testid": testID,
      },
      children,
    ),
  AttachmentLabel: ({ title, subtitle }: { title: string; subtitle: string }) =>
    React.createElement("span", null, `${title} ${subtitle}`),
}));

import { UserMessageAttachments } from "@/components/user-message-attachments";

const CHAT_HISTORY: AgentAttachment = {
  type: "text",
  mimeType: "text/plain",
  contextKind: "chat_history",
  title: "Chat history",
  text: "<chat-history-summary>\n[User] add the retry wrapper\n</chat-history-summary>",
};

const PLAIN_TEXT: AgentAttachment = {
  type: "text",
  mimeType: "text/plain",
  title: "Notes",
  text: "some other attachment",
};

afterEach(cleanup);

describe("UserMessageAttachments", () => {
  it("reveals the carried conversation when the chat history pill is pressed", () => {
    render(React.createElement(UserMessageAttachments, { attachments: [CHAT_HISTORY] }));

    // Collapsed by default: the pill names it, the transcript stays out of the way.
    expect(screen.queryByTestId("user-message-chat-history-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("user-message-chat-history-attachment"));

    const panel = screen.getByTestId("user-message-chat-history-panel");
    expect(panel.textContent).toContain("[User] add the retry wrapper");

    fireEvent.click(screen.getByTestId("user-message-chat-history-attachment"));
    expect(screen.queryByTestId("user-message-chat-history-panel")).toBeNull();
  });

  it("leaves every other attachment kind inert", () => {
    render(React.createElement(UserMessageAttachments, { attachments: [PLAIN_TEXT] }));

    // A plain text attachment is a pointer to something already open elsewhere,
    // so it gets no disclosure and no panel.
    expect(screen.queryByTestId("user-message-chat-history-attachment")).toBeNull();
    expect(screen.queryByTestId("user-message-chat-history-panel")).toBeNull();
  });
});
