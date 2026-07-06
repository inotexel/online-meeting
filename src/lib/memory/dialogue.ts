export type DialogueSpeaker = "user" | "client";

/** Map capture labels (user/seller/client/…) to coach dialogue roles. */
export function normalizeDialogueSpeaker(
  speakerLabel: string | null | undefined
): DialogueSpeaker {
  if (!speakerLabel) return "client";
  const normalized = speakerLabel.trim().toLowerCase();
  if (normalized === "user" || normalized === "seller") return "user";
  return "client";
}

/** True when the utterance is from the prospect (client), not the seller. */
export function isProspectUtterance(
  speakerLabel: string | null | undefined
): boolean {
  return normalizeDialogueSpeaker(speakerLabel) === "client";
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
