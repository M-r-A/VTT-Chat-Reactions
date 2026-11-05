import { createDatabase, IndexedDbStoreFactory } from "picmo";
import { TwemojiRenderer } from "@picmo/renderer-twemoji";
import { toCodePoints } from "./common";
// Emoji data shipped with the module, pinned in package.json. picmo would otherwise download emojibase-data@latest
// from a CDN on every client, unchecked, and put its names into its HTML templates.
import emojiData from "emojibase-data/en/data.json";
import messages from "emojibase-data/en/messages.json";

export const EMOJI_DATA = { emojiData: emojiData as any, messages: messages as any };

/** Fill picmo's emoji database from the shipped data, which the pickers read. */
export function prepareEmojiDatabase(): Promise<void> {
  return createDatabase("en", IndexedDbStoreFactory, EMOJI_DATA.messages, EMOJI_DATA.emojiData);
}

/**
 * Twemoji from the sprite sheet shipped with the renderer. An emoji without a sprite shows as text: the stock renderer
 * would load an image from a CDN (twemoji@latest) instead.
 */
export class LocalTwemojiRenderer extends TwemojiRenderer {
  render(emoji, classNames?: string) {
    if (document.getElementById(toCodePoints(emoji.emoji).join("-"))) return super.render(emoji, classNames);
    const text = document.createElement("span");
    text.textContent = emoji.emoji;
    return this.renderElement(text);
  }
}
