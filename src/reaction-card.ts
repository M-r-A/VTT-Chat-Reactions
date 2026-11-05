import utils from "./utils";
import { toCodePoints } from "./common";

/** When each user reacted: emoji -> user id -> time in ms. */
export type ReactedAt = Record<string, Record<string, number>>;

// Stored as a JSON string, like flags.world.emoji: custom emoji keys are file paths, and their dots would split a
// nested flag path
// Objects without a prototype, with numbers only: keys such as "__proto__" stay plain keys.
export function readReactedAt(message): ReactedAt {
  const reactedAt: ReactedAt = Object.create(null);
  let stored;
  try {
    stored = JSON.parse(message?.getFlag("chatreactions", "reactedAt") ?? "{}");
  } catch {
    return reactedAt;
  }
  if (!stored || typeof stored !== "object") return reactedAt;
  for (const [emoji, times] of Object.entries(stored)) {
    if (!times || typeof times !== "object") continue;
    const kept: Record<string, number> = Object.create(null);
    for (const [user, time] of Object.entries(times as Record<string, unknown>)) {
      if (typeof time === "number" && Number.isFinite(time)) kept[user] = time;
    }
    reactedAt[emoji] = kept;
  }
  return reactedAt;
}

/**
 * The order of the reaction pills: most reactions first; on equal counts, the emoji reacted with first; then by the
 * emoji's code points. Reactions from before times were recorded count as the earliest.
 */
export function sortReactions(state: Record<string, string[]>, reactedAt: ReactedAt): [string, string[]][] {
  const firstReaction = (emoji: string) => {
    const times = Object.values(reactedAt[emoji] ?? {});
    return times.length ? Math.min(...times) : -Infinity;
  };
  const byCodePoints = (a: string, b: string) => {
    const [x, y] = [a, b].map((emoji) => Array.from(emoji).map((c) => c.codePointAt(0) as number));
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const difference = (x[i] ?? -1) - (y[i] ?? -1);
      if (difference) return difference;
    }
    return 0;
  };
  // Infinity minus Infinity is NaN, which || skips like 0
  return Object.entries(state).sort(([a, votersA], [b, votersB]) =>
    votersB.length - votersA.length || firstReaction(a) - firstReaction(b) || byCodePoints(a, b));
}

/** A reaction count as shown in its pill: 999, 1K, 1.1K, …, 10K, 1M. Rounded down, so it never overstates. */
export function formatCount(count: number): string {
  const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) {
    if (count < size) continue;
    const value = Math.floor((count / size) * 10) / 10;
    return `${value >= 100 ? Math.floor(value) : value}${suffix}`;
  }
  return String(count);
}

/** "today at 14:30", "yesterday at 08:44", "Nov 2 at 08:44", in the client's language. */
export function formatReactionTime(time: number, now = new Date()): string {
  const lang = game.i18n.lang;
  const date = new Date(time);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const day = daysAgo === 0 || daysAgo === 1
    ? new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(-daysAgo, "day")
    : date.toLocaleDateString(lang, {
      day: "numeric",
      month: "short",
      year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    });
  // The locale's own short time: "08:44" in Russian, "8:44 AM" in English
  const clock = date.toLocaleTimeString(lang, { timeStyle: "short" } as Intl.DateTimeFormatOptions);
  return game.i18n.format("chatreactions.card.dayAtTime", { day, time: clock });
}

const DEFAULT_AVATAR = "icons/svg/mystery-man.svg";
const LONG_PRESS = 500;
const CARD_ID = "chat-reactions-card";

let card: HTMLElement | undefined;
let cardButton: HTMLElement | undefined;
let cardMessageId: string | undefined;
let showTimer: number | undefined;
let hideTimer: number | undefined;

// The card behaves like the core tooltips: it opens and closes after the same delay (500 ms in v12-v14), and moving
// from one pill to another while it is open switches at once
function tooltipDelay(): number {
  return (game as any).tooltip?.constructor?.TOOLTIP_ACTIVATION_MS ?? 500;
}

/** Hide the card, or only if it belongs to the given message (which is being re-rendered). */
export function hideReactionCard(messageId?: string) {
  window.clearTimeout(showTimer);
  if (messageId && messageId !== cardMessageId) return;
  window.clearTimeout(hideTimer);
  cardButton?.removeAttribute("aria-describedby");
  card?.remove();
  card = cardButton = cardMessageId = undefined;
}

/**
 * Show who reacted with an emoji, and when, in a card above the reaction pill: on hover with a mouse, on a long
 * press on touch screens. A long press does not toggle the reaction.
 * Call before adding the pill's click listener, so a long press can stop that click.
 */
export function attachReactionCard(button: HTMLElement, message, emoji: string, voters: string[]) {
  const show = () => showReactionCard(button, message, emoji, voters);
  let longPressed = false;

  button.addEventListener("pointerenter", (ev) => {
    if (ev.pointerType === "touch") return;
    window.clearTimeout(hideTimer);
    window.clearTimeout(showTimer);
    if (card?.isConnected) show(); // already open for another pill
    else showTimer = window.setTimeout(show, tooltipDelay());
  });
  button.addEventListener("pointerleave", () => {
    window.clearTimeout(showTimer);
    scheduleHide();
  });

  let pressTimer: number | undefined;
  button.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch") return;
    longPressed = false;
    pressTimer = window.setTimeout(() => {
      longPressed = true;
      show();
    }, LONG_PRESS);
  });
  for (const type of ["pointerup", "pointercancel"]) {
    button.addEventListener(type, () => window.clearTimeout(pressTimer));
  }
  button.addEventListener("click", (ev) => {
    if (!longPressed) return;
    longPressed = false;
    ev.stopImmediatePropagation();
    ev.preventDefault();
  });
  button.addEventListener("contextmenu", (ev) => {
    if (longPressed) ev.preventDefault();
  });
}

function scheduleHide() {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => hideReactionCard(), tooltipDelay());
}

// The look of the core tooltip in the current theme (light or dark from v13), copied onto the card
function applyTooltipLook(card: HTMLElement) {
  const tooltip = (game as any).tooltip?.tooltip ?? card.ownerDocument.getElementById("tooltip");
  if (!tooltip) return;
  const style = getComputedStyle(tooltip);
  const look = {
    "--chat-reactions-card-background": style.backgroundColor,
    "--chat-reactions-card-color": style.color,
    "--chat-reactions-card-border": `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
    "--chat-reactions-card-radius": style.borderTopLeftRadius,
    "--chat-reactions-card-shadow": style.boxShadow,
    "--chat-reactions-card-font": style.fontFamily,
    "--chat-reactions-card-fade": style.transitionDuration.split(",")[0],
  };
  for (const [name, value] of Object.entries(look)) {
    if (value && value !== "none" && value !== "rgba(0, 0, 0, 0)") card.style.setProperty(name, value);
  }
}

function showReactionCard(button: HTMLElement, message, emoji: string, voters: string[]) {
  hideReactionCard();
  if (!button.isConnected) return;
  const reactedAt = readReactedAt(message)[emoji] ?? {};

  // Newest first; reactions from before times were recorded go last, in the order they were added
  const rows = voters
    .map((userId, index) => ({ userId, index, time: reactedAt[userId] as number | undefined }))
    .sort((a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity) || a.index - b.index);

  const doc = button.ownerDocument;
  card = doc.createElement("div");
  card.className = "chat-reactions-card";
  // Like the core tooltip, the card describes the element it belongs to, for screen readers
  card.id = CARD_ID;
  card.setAttribute("role", "tooltip");
  cardButton = button;
  button.setAttribute("aria-describedby", CARD_ID);
  cardMessageId = message.id;
  applyTooltipLook(card);
  const list = card.appendChild(doc.createElement("ul"));
  list.className = "chat-reactions-card-list";
  for (const { userId, time } of rows) list.appendChild(cardRow(doc, userId, emoji, time));

  if (game.user && voters.includes(game.user.id as string)) {
    const hint = card.appendChild(doc.createElement("div"));
    hint.className = "chat-reactions-card-hint";
    hint.textContent = utils.localize("card.removeHint");
  }

  card.addEventListener("pointerenter", () => window.clearTimeout(hideTimer));
  card.addEventListener("pointerleave", scheduleHide);
  doc.body.appendChild(card);
  card.querySelectorAll<HTMLElement>(".chat-reactions-card-name").forEach((name) => {
    name.classList.toggle("truncated", name.scrollWidth > name.clientWidth);
  });
  placeCard(card, button);
  // Fade in, as the core tooltip does
  const shown = card;
  requestAnimationFrame(() => shown.classList.add("active"));
}

function cardRow(doc: Document, userId: string, emoji: string, time: number | undefined): HTMLElement {
  const user = game.users?.get(userId) as any;
  const name = user?.name ?? utils.localize("card.unknownUser");
  const row = doc.createElement("li");
  row.className = "chat-reactions-card-row";

  // The user's avatar, or Foundry's default one
  const avatar = row.appendChild(doc.createElement("span"));
  avatar.className = "chat-reactions-card-avatar";
  const img = avatar.appendChild(doc.createElement("img"));
  img.src = user?.avatar || DEFAULT_AVATAR;
  img.alt = "";

  const text = row.appendChild(doc.createElement("div"));
  text.className = "chat-reactions-card-text";
  const nameEl = text.appendChild(doc.createElement("span"));
  nameEl.className = "chat-reactions-card-name";
  nameEl.textContent = name;
  const meta = text.appendChild(doc.createElement("span"));
  meta.className = "chat-reactions-card-time";
  meta.appendChild(emojiIcon(doc, emoji));
  if (time) meta.append(formatReactionTime(time));
  return row;
}

function emojiIcon(doc: Document, emoji: string): Element {
  if (emoji.includes("/")) { // custom emoji: its key is the image path
    const img = doc.createElement("img");
    img.className = "emoji-image";
    img.src = emoji;
    return img;
  }
  const holder = doc.createElement("span");
  holder.innerHTML = `<svg class="emoji-image"><use xlink:href="#${toCodePoints(emoji).join("-")}"></use></svg>`;
  return holder.firstElementChild as Element;
}

// Above the pill, or below it when there is no room; inside the window
function placeCard(card: HTMLElement, button: HTMLElement) {
  const view = button.ownerDocument.defaultView ?? window;
  const pill = button.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = card;
  const margin = 6;
  let top = pill.top - height - margin;
  if (top < margin) top = pill.bottom + margin;
  const left = Math.min(Math.max(margin, pill.left), view.innerWidth - width - margin);
  card.style.top = `${Math.max(margin, top)}px`;
  card.style.left = `${Math.max(margin, left)}px`;
}
