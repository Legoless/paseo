import React, { useCallback, useMemo, useState } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { getAgentAttachmentPillContent } from "@/attachments/attachment-pill-content";
import { AttachmentFrame, AttachmentLabel } from "@/components/attachment-pill";

/**
 * Carried chat history is the one attachment worth reading back: it is the
 * conversation the receiving agent was handed in place of the one you had.
 * Every other kind points at something already open somewhere else.
 */
export function isChatHistoryAttachment(
  attachment: AgentAttachment,
): attachment is Extract<AgentAttachment, { type: "text" }> {
  return attachment.type === "text" && attachment.contextKind === "chat_history";
}

/**
 * The attachment row on a sent user message. Carried chat history expands in
 * place, because a provider switch otherwise leaves no way to read what the new
 * agent was actually told — the transcript reaches the model inside this prompt
 * and is never replayed into the timeline.
 */
export function UserMessageAttachments({
  attachments,
  containerStyle,
}: {
  attachments: readonly AgentAttachment[];
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const [isChatHistoryExpanded, setIsChatHistoryExpanded] = useState(false);
  const chatHistoryText = useMemo(() => {
    const carried = attachments.find(isChatHistoryAttachment);
    return carried ? carried.text : null;
  }, [attachments]);
  const toggleChatHistory = useCallback(() => {
    setIsChatHistoryExpanded((previous) => !previous);
  }, []);

  return (
    <>
      <View style={containerStyle}>
        {attachments.map((attachment, index) => {
          const content = getAgentAttachmentPillContent(attachment, t);
          const isChatHistory = isChatHistoryAttachment(attachment);
          return (
            <AttachmentFrame
              key={`${attachment.type}:${"number" in attachment ? attachment.number : index}`}
              onPress={isChatHistory ? toggleChatHistory : undefined}
              accessibilityLabel={
                isChatHistory ? t("message.attachments.toggleChatHistory") : undefined
              }
              testID={isChatHistory ? "user-message-chat-history-attachment" : undefined}
            >
              <AttachmentLabel
                icon={content.icon}
                title={content.title}
                subtitle={content.subtitle}
              />
            </AttachmentFrame>
          );
        })}
      </View>
      {chatHistoryText && isChatHistoryExpanded ? (
        <View style={styles.chatHistoryPanel} testID="user-message-chat-history-panel">
          <Text selectable style={styles.chatHistoryText}>
            {chatHistoryText}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  chatHistoryPanel: {
    marginTop: theme.spacing[2],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    maxWidth: "100%",
  },
  chatHistoryText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
}));
