/** True when the utterance should feed the prospect-only whisper coach. */
export function isProspectUtterance(
  speakerLabel: string | null | undefined
): boolean {
  if (!speakerLabel) return true;
  const normalized = speakerLabel.trim().toLowerCase();
  return normalized !== "user" && normalized !== "seller";
}

/** Format a transcript line with User/Client speaker labels for coach and memory. */
export function formatDialogueLine(
  speakerLabel: string | null | undefined,
  text: string
): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (speakerLabel === "user") return `User: ${trimmed}`;
  if (speakerLabel === "client") return `Client: ${trimmed}`;
  return trimmed;
}

export function formatDialogueTranscript(
  segments: Array<{ text: string; speakerLabel?: string | null }>
): string {
  return segments
    .map((segment) =>
      formatDialogueLine(segment.speakerLabel, segment.text)
    )
    .filter(Boolean)
    .join("\n");
}
