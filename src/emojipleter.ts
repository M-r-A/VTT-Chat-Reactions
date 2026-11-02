import {CustomEmoji, EmojiRecord, IndexedDbStoreFactory } from "picmo";

import {toCodePoints} from "./common";

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

/**
 * Searches emojis (custom ones first, then picmo's emoji database) for the `:query` typed in the chat input.
 */
abstract class EmojiSearch {
  private readonly _customEmojis: CustomEmoji[];
  private readonly _maxResults;
  private _db;
  private _lastSearchTime;
  protected _word = '';

  constructor(customEmojis: CustomEmoji[], maxResults) {
    this._customEmojis = customEmojis;
    this._maxResults = maxResults;
    this._db = IndexedDbStoreFactory('en');
    this._db.open();
  }

  _queryMatches(emoji, query: string) {
    return emoji.label.toLowerCase().includes(query.toLowerCase()) || emoji.tags?.some(tag => tag.toLowerCase().includes(query.toLowerCase()));
  }

  async _filter(str, searchStartTime) {
    const str2 = str.substring(1).replace(/-/g, ' ');
    const results: EmojiRecord[] = this._customEmojis.filter(emoji => this._queryMatches(emoji, str2));

    return new Promise((resolve, reject) => {
      if (results.length >= this._maxResults) return resolve(results); // Custom emojis already exceed result limit
      const transaction = this._db.db.transaction("emoji", "readonly");
      const emojiStore = transaction.objectStore("emoji");
      const request = emojiStore.openCursor();

      request.addEventListener("success", (event) => {
        const cursor = event.target.result;
        if (!cursor)
          return resolve(results)

        const emoji = cursor.value;
        if (this._queryMatches(emoji, str2)) {
          results.push(emoji);
          if (results.length >= this._maxResults) {
            return resolve(results);
          }
        }
        cursor.continue();

        if (this._lastSearchTime !== searchStartTime)
          return resolve([]);
      });

      request.addEventListener("error", (error) => {
        reject(error);
      });
    })
  }

  /** Suggestions for a query, or undefined when a newer search has started meanwhile. */
  async search(word: string): Promise<EmojiRecord[] | undefined> {
    const searchTime = Date.now();
    this._lastSearchTime = searchTime;
    const list = await this._filter(word, searchTime) as EmojiRecord[];
    if (this._lastSearchTime !== searchTime || word !== this._word) return undefined;
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
