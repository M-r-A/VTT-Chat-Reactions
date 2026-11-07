/**
 * The emoji picker: tabs of categories, a search tab with Frequently used and every category, a footer with the skin
 * tone and a preview of the hovered emoji. Its look follows Foundry's own menus in v12, and the themes of v13 and v14
 * (styles/module.css, "Emoji picker"). Design: tabs in Slack's order, Twemoji everywhere.
 *
 * Data, search, favorites and the skin tone come from the Database of emoji-picker-element; its <emoji-picker> element
 * is never imported, so nothing can load its default data from a CDN. The data ships with the module (data/emoji.json).
 */
import Database from "emoji-picker-element/database";
import type { CustomEmoji, Emoji, NativeEmoji, SkinTone } from "emoji-picker-element/shared";

/** A custom emoji of the module: the emoji folder or an emoji pack. */
export interface PickerCustomEmoji {
  name: string;
  url: string;
  category: string;
}

/** What the user chose: a unicode emoji (in the chosen skin tone), or a custom emoji. */
export type PickerChoice = { unicode: string } | { name: string; url: string };

export interface PickerOptions {
  dataUrl: string;
  customEmojis: PickerCustomEmoji[];
  /** Emojibase groups to show (0 smileys … 9 flags). */
  groups: Set<number>;
  showCustom: boolean;
  /** How many emoji Frequently used shows; 0 hides it. */
  frequentCount: number;
  showPreview: boolean;
  /** Picker colors changed from their defaults in the settings; they win over the theme. */
  colors: { background?: string; text?: string; accent?: string };
  /** Shown only when given: the upload of custom emojis. */
  onAddEmoji?: () => void;
}

interface Tab {
  id: string;
  icon: string;
  groups?: number[];
  custom?: boolean;
}

// Tabs in Slack's order, with Font Awesome icons (FA 6 in Foundry 12 and 13, FA 7 in 14), in their outline style
const TABS: Tab[] = [
  { id: "search", icon: "fa-magnifying-glass" },
  { id: "people", icon: "fa-face-laugh", groups: [0, 1] },
  { id: "nature", icon: "fa-leaf", groups: [3] },
  { id: "food", icon: "fa-utensils", groups: [4] },
  { id: "travel", icon: "fa-plane", groups: [5] },
  { id: "activities", icon: "fa-basketball", groups: [6] },
  { id: "objects", icon: "fa-lightbulb", groups: [7] },
  { id: "symbols", icon: "fa-peace", groups: [8] },
  { id: "flags", icon: "fa-flag", groups: [9] },
  { id: "custom", icon: "fa-dice-d20", custom: true },
];
const COLUMNS = 8;
// Until someone has chosen emojis, Frequently used shows these
const DEFAULT_FREQUENT = [
  "😊",
  "😒",
  "❤️",
  "👍",
  "😍",
  "😂",
  "😭",
  "☺️",
  "😔",
  "😩",
  "😏",
  "💕",
  "🙌",
  "😘",
  "🎉",
  "🔥",
];
const TONES = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];
const GAP = 6;
const MARGIN = 8;

let options: PickerOptions | undefined;
let database: Database | undefined;
let current: { anchor: HTMLElement; dispose: () => void } | undefined;

const t = (key: string) => game.i18n.localize(`chatreactions.picker.${key}`);

/** Set the picker up, or update it (custom emojis loaded later). Starts filling the emoji database. */
export function configurePicker(next: PickerOptions) {
  options = next;
  const customEmoji: CustomEmoji[] = next.customEmojis.map(({ name, url, category }) => ({
    name,
    url,
    category,
    shortcodes: [name],
  }));
  if (database) database.customEmoji = customEmoji;
  else database = new Database({ dataSource: next.dataUrl, customEmoji });
}

/** Open the picker from its button, or close it if it is open there. */
export function togglePicker(anchor: HTMLElement, onChoose: (choice: PickerChoice) => void) {
  if (current?.anchor === anchor) return closePicker();
  closePicker();
  if (options && database) open(anchor, onChoose, options, database);
}

export function closePicker() {
  current?.dispose();
  current = undefined;
}

export const isPickerOpen = () => current !== undefined;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const { dataset, ...rest } = props;
  const node = Object.assign(doc.createElement(tag), rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

/**
 * The theme a floating element takes from where it opens, as core's ContextMenu and Autocomplete do (v13+). Foundry 13
 * marks the chat log light to draw the message cards as parchment; a picker opened from a message follows the sidebar.
 */
function themeOf(anchor: HTMLElement): string | undefined {
  let themed = anchor.closest(".themed");
  while (themed?.matches(".chat-log")) themed = themed.parentElement?.closest(".themed") ?? null;
  return [...(themed ?? anchor.ownerDocument.body).classList].find((name) => name.startsWith("theme-"));
}

/**
 * A popped-out window (PopOut! module) may lack the module's styles: copy them over. Foundry 14's detached windows
 * copy every stylesheet themselves.
 */
function ensureStyles(doc: Document) {
  if (doc === document || doc.getElementById("chat-reactions-styles")) return;
  const probe = el(doc, "div", { className: "crp" });
  doc.body.append(probe);
  const styled = doc.defaultView?.getComputedStyle(probe).display === "flex";
  probe.remove();
  if (styled) return;
  const marker = el(doc, "meta", { id: "chat-reactions-styles" });
  doc.head.append(marker);
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    const source = node instanceof HTMLLinkElement ? node.href : (node.textContent ?? "");
    if (source.includes("modules/chatreactions/")) doc.head.append(doc.importNode(node, true));
  }
}

function open(anchor: HTMLElement, onChoose: (choice: PickerChoice) => void, opts: PickerOptions, db: Database) {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  ensureStyles(doc);

  const picker = el(doc, "div", { className: "crp", role: "dialog" });
  picker.setAttribute("aria-label", t("label"));
  const generation = Number((game.release as any)?.generation ?? 12);
  const theme = generation >= 13 ? themeOf(anchor) : undefined;
  if (theme) picker.classList.add("themed", theme);
  else picker.classList.add("crp-v12");
  for (const [name, value] of Object.entries(opts.colors)) {
    if (!value) continue;
    picker.dataset[`custom${name[0].toUpperCase()}${name.slice(1)}`] = "";
    picker.style.setProperty(`--crp-custom-${name}`, value);
  }

  let tone = 0 as SkinTone;
  const unicodeOf = (emoji: NativeEmoji) => emoji.skins?.find((skin) => skin.tone === tone)?.unicode ?? emoji.unicode;
  const isCustom = (emoji: Emoji): emoji is CustomEmoji => "url" in emoji;

  // --- Footer: skin tone, the upload when available, the preview of the hovered emoji ---
  const skinHand = el(doc, "span", { className: "twemoji crp-skin-hand", textContent: TONES[0] });
  const skinButton = el(doc, "button", { type: "button", className: "crp-skin" }, skinHand, t("skinTone"));
  const actions = el(doc, "div", { className: "crp-actions" });
  if (opts.onAddEmoji) {
    const add = el(doc, "button", { type: "button", textContent: t("addEmoji") });
    add.addEventListener("click", () => {
      closePicker();
      opts.onAddEmoji?.();
    });
    actions.append(add);
  }
  actions.append(skinButton);
  const tones = el(doc, "div", { className: "crp-tones", role: "listbox" });
  tones.setAttribute("aria-label", t("skinTone"));
  const previewEmoji = el(doc, "span", { className: "crp-preview-emoji" });
  const previewName = el(doc, "span", { className: "crp-preview-name" });
  const previewCodes = el(doc, "span", { className: "crp-preview-codes" });
  const preview = el(
    doc,
    "div",
    { className: "crp-preview" },
    previewEmoji,
    el(doc, "div", { className: "crp-preview-text" }, previewName, previewCodes),
  );
  const footer = el(doc, "footer", { className: "crp-footer" }, actions, tones, preview);

  const tabs = el(doc, "nav", { className: "crp-tabs", role: "tablist" });
  const body = el(doc, "div", { className: "crp-body" });
  picker.append(tabs, body, footer);

  function showPreview(emoji: Emoji) {
    if (!opts.showPreview || footer.classList.contains("choosing-tone")) return;
    if (isCustom(emoji)) previewEmoji.replaceChildren(el(doc, "img", { src: emoji.url, alt: "" }));
    else previewEmoji.replaceChildren(el(doc, "span", { className: "twemoji", textContent: unicodeOf(emoji) }));
    const name = isCustom(emoji) ? emoji.name : emoji.annotation;
    previewName.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    const codes = (emoji.shortcodes ?? [emoji.name ?? ""]).map((code) => `:${code}:`).join(" ");
    previewCodes.textContent = isCustom(emoji) && emoji.category ? `${codes} · ${emoji.category}` : codes;
    footer.classList.add("previewing");
  }
  const hidePreview = () => footer.classList.remove("previewing");
  picker.addEventListener("mouseleave", hidePreview);
  picker.addEventListener("mouseover", (event) => {
    if (!(event.target as Element).closest(".crp-emoji")) hidePreview();
  });
  picker.addEventListener("focusout", (event) => {
    if (!(event.relatedTarget as Element | null)?.closest?.(".crp-emoji")) hidePreview();
  });

  function choose(emoji: Emoji) {
    db.incrementFavoriteEmojiCount(isCustom(emoji) ? emoji.name : emoji.unicode).catch(() => {});
    closePicker();
    onChoose(isCustom(emoji) ? { name: emoji.name, url: emoji.url } : { unicode: unicodeOf(emoji) });
  }

  function emojiButton(emoji: Emoji): HTMLButtonElement {
    const label = isCustom(emoji) ? `:${emoji.name}:` : emoji.annotation;
    const button = el(doc, "button", { type: "button", className: "crp-emoji", tabIndex: -1 });
    button.setAttribute("aria-label", label); // the footer shows the name, so no tooltip
    if (isCustom(emoji)) button.append(el(doc, "img", { src: emoji.url, alt: "", draggable: false }));
    else button.append(el(doc, "span", { className: "twemoji", textContent: unicodeOf(emoji) }));
    button.addEventListener("click", () => choose(emoji));
    button.addEventListener("mouseenter", () => showPreview(emoji));
    button.addEventListener("focus", () => showPreview(emoji));
    return button;
  }

  function section(title: string, emojis: Emoji[]): HTMLElement {
    const heading = el(doc, "div", { className: "crp-heading", textContent: title, role: "heading" });
    heading.setAttribute("aria-level", "3");
    const grid = el(doc, "div", { className: "crp-grid", role: "group" }, ...emojis.map(emojiButton));
    grid.setAttribute("aria-label", title);
    return el(doc, "section", { className: "crp-section" }, heading, grid);
  }

  const tabLabel = (tab: Tab) => t(`tabs.${tab.id}`);
  const groupEmojis = async (groups: number[]) =>
    (await Promise.all(groups.filter((g) => opts.groups.has(g)).map((g) => db.getEmojiByGroup(g)))).flat();
  function customSections(): HTMLElement[] {
    const byCategory = new Map<string, Emoji[]>();
    for (const emoji of db.customEmoji as Emoji[]) {
      const category = (emoji as CustomEmoji).category ?? t("tabs.custom");
      byCategory.set(category, [...(byCategory.get(category) ?? []), emoji]);
    }
    return [...byCategory].map(([category, emojis]) => section(category, emojis));
  }
  async function frequent(): Promise<Emoji[]> {
    const top = await db.getTopFavoriteEmoji(opts.frequentCount);
    if (top.length) return top;
    const defaults = await Promise.all(
      DEFAULT_FREQUENT.slice(0, opts.frequentCount).map((u) => db.getEmojiByUnicodeOrName(u)),
    );
    return defaults.filter((e): e is Emoji => !!e);
  }

  // Only the tabs with something to show
  const visibleTabs = TABS.filter(
    (tab) =>
      tab.id === "search" ||
      (tab.custom ? opts.showCustom && db.customEmoji.length > 0 : tab.groups!.some((g) => opts.groups.has(g))),
  );
  for (const tab of visibleTabs) {
    const button = el(
      doc,
      "button",
      {
        type: "button",
        className: "crp-tab",
        role: "tab",
        tabIndex: -1,
        dataset: { tab: tab.id, tooltip: tabLabel(tab) },
      },
      el(doc, "i", { className: `fa-regular ${tab.icon}` }),
    );
    button.setAttribute("aria-label", tabLabel(tab));
    button.addEventListener("click", () => show(tab.id));
    tabs.append(button);
  }
  // Tabs: arrows move between them, as a tablist
  tabs.addEventListener("keydown", (event) => {
    const buttons = [...tabs.querySelectorAll<HTMLButtonElement>(".crp-tab")];
    const at = buttons.indexOf(event.target as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (at < 0 || !step) return;
    event.preventDefault();
    const next = buttons[(at + step + buttons.length) % buttons.length];
    next.focus();
    show(next.dataset.tab!);
  });

  let shown = "";
  let showing = 0;
  async function show(id: string, query = "") {
    const run = ++showing;
    shown = id;
    for (const button of tabs.querySelectorAll<HTMLButtonElement>(".crp-tab")) {
      const selected = button.dataset.tab === id;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    const tab = TABS.find((x) => x.id === id)!;
    const scroll = el(doc, "div", { className: "crp-scroll" });
    const parts: HTMLElement[] = [];
    if (id === "search") {
      const input = el(doc, "input", { type: "search", placeholder: t("searchPlaceholder"), value: query });
      input.setAttribute("aria-label", t("searchPlaceholder"));
      input.addEventListener("input", () => show("search", input.value));
      input.addEventListener("keydown", (event) => {
        const first = scroll.querySelector<HTMLButtonElement>(".crp-emoji");
        if (event.key === "ArrowDown" && first) {
          event.preventDefault();
          first.focus();
        } else if (event.key === "Enter" && first && input.value.trim()) {
          event.preventDefault();
          first.click();
        }
      });
      parts.push(el(doc, "div", { className: "crp-search" }, input));
    }
    const sections: HTMLElement[] = [];
    try {
      if (id === "search" && query.trim()) {
        const results = await db.getEmojiBySearchQuery(query.trim());
        if (results.length) sections.push(section(t("searchResults"), results));
        else sections.push(el(doc, "div", { className: "crp-empty", textContent: t("noResults") }));
      } else if (id === "search") {
        if (opts.frequentCount > 0) sections.push(section(t("frequent"), await frequent()));
        for (const x of visibleTabs.filter((v) => v.groups)) {
          sections.push(section(tabLabel(x), await groupEmojis(x.groups!)));
        }
        if (opts.showCustom) sections.push(...customSections());
      } else if (tab.custom) {
        sections.push(...customSections());
      } else {
        sections.push(section(tabLabel(tab), await groupEmojis(tab.groups!)));
      }
    } catch (error) {
      console.error("Chat Reactions | emoji data", error);
      sections.push(el(doc, "div", { className: "crp-empty", textContent: t("dataError") }));
    }
    if (run !== showing) return; // a newer tab or query took over meanwhile
    scroll.append(...sections);
    scroll.querySelector<HTMLButtonElement>(".crp-emoji")?.setAttribute("tabindex", "0");
    const focused = doc.activeElement;
    body.replaceChildren(...parts, scroll);
    const input = body.querySelector("input");
    if (input && (query || focused === doc.body || !picker.contains(focused))) {
      input.focus();
      input.setSelectionRange(query.length, query.length);
    }
  }

  // Grid: arrows move between emojis (a row is 8 across), Home and End go to the first and the last
  body.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("crp-emoji")) return;
    const buttons = [...body.querySelectorAll<HTMLButtonElement>(".crp-emoji")];
    const at = buttons.indexOf(target as HTMLButtonElement);
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
      Home: -at,
      End: buttons.length - 1 - at,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const next = at + steps[event.key];
    if (next < 0 && event.key === "ArrowUp") {
      body.querySelector("input")?.focus();
      return;
    }
    const button = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
    target.tabIndex = -1;
    button.tabIndex = 0;
    button.focus();
    button.scrollIntoView({ block: "nearest" });
  });

  // Skin tone: the footer turns into the six tones until one is chosen
  function chooseTone(next: SkinTone) {
    tone = next;
    skinHand.textContent = TONES[tone];
    footer.classList.remove("choosing-tone");
    db.setPreferredSkinTone(tone).catch(() => {});
    show(shown, body.querySelector("input")?.value ?? "");
    skinButton.focus();
  }
  TONES.forEach((hand, index) => {
    const option = el(doc, "button", { type: "button", className: "crp-tone", role: "option" });
    option.append(el(doc, "span", { className: "twemoji", textContent: hand }));
    option.setAttribute("aria-label", t(`tones.${index}`));
    option.addEventListener("click", () => chooseTone(index as SkinTone));
    tones.append(option);
  });
  skinButton.addEventListener("click", () => {
    hidePreview();
    footer.classList.add("choosing-tone");
    tones.querySelectorAll(".crp-tone").forEach((option, index) => {
      option.setAttribute("aria-selected", String(index === tone));
    });
    tones.querySelector<HTMLButtonElement>(`.crp-tone:nth-child(${tone + 1})`)?.focus();
  });

  // --- Popover: in the button's own document, above it and right-aligned, inside the window. v13+ show core's
  // tooltips as popovers too, which open above it; v12 has no popovers, so its tooltips could not rise above one:
  // there the picker is a fixed element just below the tooltip (styles/module.css). ---
  const host = el(doc, "div", { className: "crp-popover" });
  if (generation >= 13) host.popover = "manual";
  host.append(picker);
  doc.body.append(host);
  if (generation >= 13) host.showPopover();
  const place = () => {
    if (!anchor.isConnected) return closePicker(); // the message or the chat input was rendered anew
    const a = anchor.getBoundingClientRect();
    const w = picker.offsetWidth;
    const h = picker.offsetHeight;
    const left = Math.min(Math.max(MARGIN, a.right - w), win.innerWidth - w - MARGIN);
    const above = a.top - h - GAP;
    const top = above >= MARGIN ? above : Math.min(a.bottom + GAP, win.innerHeight - h - MARGIN);
    host.style.left = `${Math.max(MARGIN, left)}px`;
    host.style.top = `${Math.max(MARGIN, top)}px`;
  };
  place();
  body.append(el(doc, "div", { className: "crp-empty", textContent: t("loading") }));

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    closePicker();
  };
  const onPointer = (event: PointerEvent) => {
    const target = event.target as Node;
    if (!host.contains(target) && !anchor.contains(target)) closePicker();
  };
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("pointerdown", onPointer, true);
  win.addEventListener("resize", place);
  doc.addEventListener("scroll", place, true);
  // The chat's emoji button is pressed while its picker is open (a core icon control in v13+, styled in v12)
  const pressable = anchor.classList.contains("chat-reactions-picker");
  if (pressable) anchor.setAttribute("aria-pressed", "true");
  current = {
    anchor,
    dispose() {
      if (pressable) anchor.removeAttribute("aria-pressed");
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onPointer, true);
      win.removeEventListener("resize", place);
      doc.removeEventListener("scroll", place, true);
      if (host.popover && host.matches(":popover-open")) host.hidePopover();
      host.remove();
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    },
  };

  db.ready()
    .then(() => db.getPreferredSkinTone())
    .then((preferred) => {
      tone = preferred;
      skinHand.textContent = TONES[tone];
    })
    .catch(() => {})
    .then(() => {
      if (current?.anchor === anchor) show("search");
    });
}
