import { emojiRanges } from "./emoji-match";
import { twemoji } from "./twemoji";

// Custom emoji codes, as chat messages hold them: :name:
const CUSTOM_CODE = /:([A-Za-z0-9_]+):/g;
// Text in these elements stays as typed
const SKIPPED = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA"]);

type Piece = { start: number; end: number; element: Element };

/**
 * Show emojis in the text of a message: unicode emojis in the Twemoji font, known custom emoji codes (:name:) as their
 * images.
 * Only text nodes change, and new elements are built with the DOM: the message's own markup, attributes included,
 * is never serialized and parsed again. Unknown codes stay as they are.
 */
export function renderMessageEmojis(root: HTMLElement, customEmojiUrl: (name: string) => string | undefined) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
        if (SKIPPED.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) replaceInText(node, customEmojiUrl);

  // A message of emojis only shows them large: no text left outside the emojis (which are text in the Twemoji font)
  const textWalker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let onlyEmojis = true;
  while (onlyEmojis && textWalker.nextNode()) {
    const node = textWalker.currentNode as Text;
    if (node.data.trim() && !node.parentElement?.closest(".twemoji")) onlyEmojis = false;
  }
  if (onlyEmojis) {
    root.querySelectorAll(".emoji").forEach((emoji) => emoji.classList.add("emoji-large"));
  }
}

function replaceInText(node: Text, customEmojiUrl: (name: string) => string | undefined) {
  const text = node.data;
  const doc = node.ownerDocument;
  const pieces: Piece[] = [];

  for (const { start, end, text: emoji } of emojiRanges(text)) {
    pieces.push({ start, end, element: twemoji(doc, emoji, "emoji") });
  }
  CUSTOM_CODE.lastIndex = 0;
  for (let match = CUSTOM_CODE.exec(text); match; match = CUSTOM_CODE.exec(text)) {
    const url = customEmojiUrl(match[1]);
    if (!url) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (pieces.some((p) => p.start < end && start < p.end)) continue;
    const img = doc.createElement("img");
    img.className = "emoji";
    img.src = url;
    pieces.push({ start, end, element: img });
  }
  if (!pieces.length) return;

  pieces.sort((a, b) => a.start - b.start);
  const fragment = doc.createDocumentFragment();
  let at = 0;
  for (const { start, end, element } of pieces) {
    if (start < at) continue;
    if (start > at) fragment.append(text.slice(at, start));
    fragment.append(element);
    at = end;
  }
  if (at < text.length) fragment.append(text.slice(at));
  node.replaceWith(fragment);
}
