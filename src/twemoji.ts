/**
 * An emoji drawn with the module's Twemoji font (styles/module.css, fonts/twemoji.woff2): the same look in the picker,
 * in messages, on reaction pills and in suggestions, whatever the client's own emoji font. An emoji the font has no
 * glyph for falls back to the system's.
 */
export function twemoji(doc: Document, emoji: string, ...classNames: string[]): HTMLSpanElement {
  const span = doc.createElement("span");
  span.classList.add("twemoji", ...classNames);
  span.textContent = emoji;
  return span;
}
