import { CustomEmoji, EmojiRecord } from "picmo";

import { toCodePoints } from "./common";
import { EMOJI_DATA } from "./local-emoji-data";

// A colon followed by at least two word characters, right before the cursor
const QUERY_PATTERN = /(?:^|\s)(:[\w-]{2,})$/;

/** The `:query` right before the cursor, if any. */
function queryBefore(text: string): string | undefined {
  return QUERY_PATTERN.exec(text)?.[1];
}

/** What a chosen suggestion inserts: the emoji itself, or `:name:` for a custom emoji. */
function identifierOf(e: EmojiRecord) {
  return e.url ? `:${e.emoji}:` : e.emoji;
}

/** Icon and label of a suggestion. */
function labelOf(e: EmojiRecord): DocumentFragment {
  const label = document.createDocumentFragment();
  if (e.url) { // custom emoji
    const img = document.createElement('img');
    img.src = e.url;
    img.classList.add('emoji');
    img.draggable = false;
    label.appendChild(img);
  } else {
    const svg = document.createElement('span');
    svg.innerHTML = `<svg class="emoji"><use xlink:href="#${toCodePoints(e.emoji).join('-')}"></use></svg>`;
    label.appendChild(svg.firstElementChild as Element);
  }
  label.append(e.label.replace(/ /g, '-'));
  return label;
}

/** An emoji with its label and tags in lower case, for matching a query without converting them each time. */
interface SearchEntry {
  emoji: EmojiRecord;
  terms: string[];
}

function searchEntry(emoji: EmojiRecord): SearchEntry {
  return { emoji, terms: [emoji.label, ...(emoji.tags ?? [])].map(term => term.toLowerCase()) };
}

// The shipped emoji data, in the order of picmo's database (by the emoji's code units), which the suggestions came in
// when they were read from it
let unicodeEntries: SearchEntry[] | undefined;
function unicodeEmojis(): SearchEntry[] {
  unicodeEntries ??= (EMOJI_DATA.emojiData as EmojiRecord[])
    .slice()
    .sort((a, b) => a.emoji < b.emoji ? -1 : a.emoji > b.emoji ? 1 : 0)
    .map(searchEntry);
  return unicodeEntries;
}

/**
 * Searches emojis (custom ones first, then the shipped emoji data) for the `:query` typed in the chat input.
 * The search runs in memory: reading picmo's IndexedDB on each keystroke took seconds in some browsers, and found
 * nothing while the database was still being filled.
 */
abstract class EmojiSearch {
  private readonly _customEmojis: CustomEmoji[];
  private readonly _maxResults;
  protected _word = '';

  constructor(customEmojis: CustomEmoji[], maxResults) {
    this._customEmojis = customEmojis;
    this._maxResults = maxResults;
  }

  /** Suggestions for a `:query`: emojis whose label or a tag contains it, `-` standing for a space. */
  _filter(word: string): EmojiRecord[] {
    const query = word.substring(1).replace(/-/g, ' ').toLowerCase();
    const results: EmojiRecord[] = [];
    // Custom emojis can change at any time (uploads, settings), so they are matched as they are
    for (const emoji of this._customEmojis) {
      if (results.length >= this._maxResults) return results;
      if (searchEntry(emoji as EmojiRecord).terms.some(term => term.includes(query))) results.push(emoji as EmojiRecord);
    }
    for (const { emoji, terms } of unicodeEmojis()) {
      if (results.length >= this._maxResults) break;
      if (terms.some(term => term.includes(query))) results.push(emoji);
    }
    return results;
  }

  /** Suggestions for a query, or undefined when the input has moved on to another query meanwhile. */
  async search(word: string): Promise<EmojiRecord[] | undefined> {
    const list = this._filter(word);
    if (word !== this._word) return undefined;
    return list;
  }

  abstract close(): void;
}

/**
 * Suggestions for the ProseMirror chat input of v14, shown in the core autocomplete menu. The menu also handles
 * Enter/Tab/Arrow/Escape before the chat input sees them.
 */
export class AutocompleteEmojiPleter extends EmojiSearch {
  private readonly _autocomplete;
  private _view;

  constructor(customEmojis: CustomEmoji[], maxResults) {
    super(customEmojis, maxResults);
    const { Autocomplete } = (foundry as any).applications.ux;
    this._autocomplete = new Autocomplete.implementation({
      onSelect: (identifier, label, { prefix }) => this.select(identifier, label, prefix)
    });
  }

  /**
   * Inspect the text before the cursor after each change of the chat input.
   * @param view  The ProseMirror EditorView of the chat input.
   */
  onViewUpdate(view) {
    this._view = view;
    const { $cursor } = view.state.selection;
    const preText = $cursor ? $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, "￼") : "";
    const word = queryBefore(preText);
    if (!word) {
      this._word = '';
      this.close();
      return;
    }
    if (word === this._word) return;
    this._word = word;
    this.update(word);
  }

  async update(word) {
    const list = await this.search(word);
    if (!list) return; // a newer search was started
    if (list.length === 0) return this.close();

    const target = this._view?.dom as HTMLElement | undefined;
    if (!target) return;
    this._autocomplete.activate(target, list.map(e => ({ identifier: identifierOf(e), label: labelOf(e) })), { prefix: word });
    this._autocomplete.select(); // preselect the first entry, as the old popup did

    // The chat input sits at the bottom of the screen, so open the menu upwards
    const menu = this._autocomplete.element as HTMLElement | null;
    if (menu) {
      const { top } = target.getBoundingClientRect();
      menu.style.top = `${Math.max(0, top - menu.offsetHeight)}px`;
    }
  }

  close() {
    if ((ui as any).autocomplete === this._autocomplete) this._autocomplete.dismiss();
  }

  select(identifier: string, label: string, prefix: string) {
    const view = this._view;
    if (!view || !Hooks.call('emojuleSelectEmoji', label, view.dom)) return;

    // Replace the typed `:query` before the cursor with the chosen emoji
    const { state } = view;
    const { $cursor } = state.selection;
    if (!$cursor || !prefix) return;
    const preText = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, "￼");
    if (!preText.endsWith(prefix)) return;
    view.dispatch(state.tr.insertText(identifier, $cursor.pos - prefix.length, $cursor.pos));
    view.focus();
    this._word = '';
  }
}

/**
 * Suggestions for the textarea chat input of v12-v13, in the module's own popup above the input.
 * Keys are caught on the window in the capture phase, before the core chat handlers send the message on Enter.
 * The textarea is found by id, as v13 moves it between the sidebar and the notification area.
 */
export class TextareaEmojiPleter extends EmojiSearch {
  private _element: HTMLTextAreaElement | undefined;
  private _html: HTMLDivElement | undefined;
  private _selected: HTMLElement | undefined;

  constructor(customEmojis: CustomEmoji[], maxResults) {
    super(customEmojis, maxResults);
    window.addEventListener('input', (ev) => this._onInput(ev), true);
    window.addEventListener('keydown', (ev) => this._onKeyDown(ev), true);
  }

  _isChatInput(target): target is HTMLTextAreaElement {
    return target instanceof HTMLTextAreaElement && target.id === 'chat-message';
  }

  _onInput(ev: Event) {
    if (!this._isChatInput(ev.target)) return;
    this._element = ev.target;
    const word = queryBefore(this._element.value.substring(0, this._element.selectionStart));
    if (!word) {
      this._word = '';
      this.close();
      return;
    }
    if (word === this._word) return;
    this._word = word;
    this.update(word);
  }

  _onKeyDown(ev: KeyboardEvent) {
    if (!this._html || ev.target !== this._element || ev.isComposing) return;
    switch (ev.key) {
      case 'Enter':
      case 'Tab':
        if (this._selected) this.select(this._selected);
        break;
      case 'Escape':
        this.close();
        break;
      case 'ArrowUp': // the list grows upwards from the input
        this._highlight(this._selected?.nextElementSibling as HTMLElement | null);
        break;
      case 'ArrowDown':
        this._highlight(this._selected?.previousElementSibling as HTMLElement | null);
        break;
      default:
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  }

  _highlight(li: HTMLElement | null | undefined) {
    if (!li) return;
    this._selected?.classList.remove('selected');
    li.classList.add('selected');
    this._selected = li;
  }

  async update(word) {
    const list = await this.search(word);
    if (!list) return; // a newer search was started
    if (list.length === 0) return this.close();

    const ul = document.createElement('ul');
    ul.classList.add('emojipleter-emojilist');
    for (const e of list) {
      const li = ul.appendChild(document.createElement('li'));
      li.classList.add('emojipleter-emoji');
      li.dataset.identifier = identifierOf(e);
      li.dataset.label = e.label.replace(/ /g, '-');
      li.appendChild(labelOf(e));
    }
    this._show(ul);
    this._highlight(ul.firstElementChild as HTMLElement);
  }

  _show(list: HTMLUListElement) {
    if (!this._html) {
      this._html = document.createElement('div');
      this._html.id = 'emojipleter';
      // Keep the focus in the input while clicking a suggestion
      this._html.addEventListener('mousedown', ev => ev.preventDefault());
      this._html.addEventListener('click', ev => {
        const li = (ev.target as Element | null)?.closest<HTMLElement>('.emojipleter-emoji');
        if (li) this.select(li);
      });
      this._html.addEventListener('mousemove', ev => {
        this._highlight((ev.target as Element | null)?.closest<HTMLElement>('.emojipleter-emoji'));
      });
      document.body.appendChild(this._html);
    }
    this._html.replaceChildren(list);

    // Open upwards from the input, as wide as it
    const rect = (this._element as HTMLTextAreaElement).getBoundingClientRect();
    this._html.style.left = `${rect.left}px`;
    this._html.style.width = `${rect.width}px`;
    this._html.style.bottom = `${window.innerHeight - rect.top}px`;
    this._html.scrollTop = this._html.scrollHeight;
  }

  close() {
    this._html?.remove();
    this._html = undefined;
    this._selected = undefined;
  }

  select(li: HTMLElement) {
    const element = this._element;
    const { identifier, label } = li.dataset;
    if (!element || !identifier || !Hooks.call('emojuleSelectEmoji', label, element)) return;

    // Replace the typed `:query` before the cursor with the chosen emoji
    const end = element.selectionStart;
    const word = queryBefore(element.value.substring(0, end));
    if (!word) return this.close();
    element.setRangeText(identifier, end - word.length, end, 'end');
    element.focus();
    this._word = '';
    this.close();
  }
}

export type EmojiPleter = AutocompleteEmojiPleter | TextareaEmojiPleter;

/** The emojipleter for this core version: the core autocomplete menu exists from v14, along with the ProseMirror input. */
export default function createEmojiPleter(customEmojis: CustomEmoji[], maxResults): EmojiPleter {
  return (foundry as any).applications?.ux?.Autocomplete
    ? new AutocompleteEmojiPleter(customEmojis, maxResults)
    : new TextareaEmojiPleter(customEmojis, maxResults);
}
