import { parse } from "@twemoji/parser";

/**
 * The browser's own list of emoji (Unicode's RGI set, through the ES2024 v flag), or null where the engine lacks it.
 * It only knows the emoji of the browser's Unicode version: Chromium 122 of the Foundry 12 app stops at Unicode 15.0.
 * Twemoji's parser knows the newest emoji whatever the browser, but splits some forms the picker data uses: an emoji
 * with U+FE0F though it already shows as emoji (👽️), a skin tone on a base that is text by default (🖐🏻).
 */
function rgi(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
const RGI_EMOJI = rgi("^\\p{RGI_Emoji}$", "v");
const RGI_EMOJIS = rgi("\\p{RGI_Emoji}", "gv");

/** Whether a string is exactly one emoji of the browser's list, as written or without U+FE0F. */
export function isRgiEmoji(text: string): boolean {
  return !!RGI_EMOJI && (RGI_EMOJI.test(text) || RGI_EMOJI.test(text.replaceAll("️", "")));
}

/**
 * Where the emojis are in a text: the parser's matches, joined by the browser's for what the parser splits. Where
 * matches overlap, the one starting first wins, and of those the longest.
 */
export function emojiRanges(text: string): { start: number; end: number; text: string }[] {
  const found = parse(text).map(({ indices: [start, end] }) => ({ start, end }));
  if (RGI_EMOJIS) {
    RGI_EMOJIS.lastIndex = 0;
    for (let match = RGI_EMOJIS.exec(text); match; match = RGI_EMOJIS.exec(text)) {
      let end = match.index + match[0].length;
      if (text[end] === "️") end++; // 👽️: the list has no U+FE0F after an emoji shown as emoji anyway
      found.push({ start: match.index, end });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges: { start: number; end: number; text: string }[] = [];
  let at = 0;
  for (const { start, end } of found) {
    if (start < at) continue;
    ranges.push({ start, end, text: text.slice(start, end) });
    at = end;
  }
  return ranges;
}
