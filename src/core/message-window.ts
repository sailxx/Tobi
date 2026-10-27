// The message window (message.html): one chat message whole, in a window the user can resize.
// The island sends what it shows; the photo, when there is one, is fetched by the window itself.

export interface MessageWindowData {
  /** The pill id of the messenger it came from (integration_telegram, integration_whatsapp). */
  messenger: string;
  chat: string;
  id: string;
  /** Who wrote it, as the island shows it. */
  who: string;
  /** The date and time, already in the user's language. */
  when: string;
  /** The whole text, trimmed; "" for a bare photo or voice message. */
  text: string;
  /** The label of a media with no text of its own ("Voice message"), English key; "" when none. */
  media: string;
  /** Whether a photo can be fetched for it. */
  photo: boolean;
}

/** The window's title: who wrote, cut short. */
export function windowTitle(d: MessageWindowData | null): string {
  const who = d?.who.trim() ?? "";
  return who ? `${who.length > 40 ? `${who.slice(0, 39)}…` : who} · Tobi` : "Tobi";
}
