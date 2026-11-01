import {CustomEmoji, EmojiRecord, IndexedDbStoreFactory } from "picmo";

import {toCodePoints} from "./common";

// A colon followed by at least two word characters, right before the cursor
const QUERY_PATTERN = /(?:^|\s)(:[\w-]{2,})$/;

/**
 * Suggests emoji completions in the chat input while a `:query` is typed.
 * Suggestions are shown in the core autocomplete menu, which also handles Enter/Tab/Arrow/Escape before the chat
 * input sees them.
 */
export default class EmojiPleter {
  private readonly _customEmojis: CustomEmoji[];
  private readonly _maxResults;
  private readonly _autocomplete;
  private _db;
  private _view;
  private _word = '';
  private _lastSearchTime;

  constructor(customEmojis: CustomEmoji[], maxResults) {
    this._customEmojis = customEmojis;
    this._maxResults = maxResults;
    this._db = IndexedDbStoreFactory('en');
    this._db.open();
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
    const word = QUERY_PATTERN.exec(preText)?.[1];
    if (!word) {
      this._word = '';
      this.close();
      return;
    }
    if (word === this._word) return;
    this._word = word;
    this.update(word);
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

  async update(word) {
    const searchTime = Date.now();
    this._lastSearchTime = searchTime;
    const list = await this._filter(word, searchTime) as EmojiRecord[];
    if (this._lastSearchTime !== searchTime || word !== this._word) return; // a newer search was started
    if (list.length === 0) return this.close();

    const target = this._view?.dom as HTMLElement | undefined;
    if (!target) return;
    this._autocomplete.activate(target, list.map(e => this._toEntry(e)), { prefix: word });
    this._autocomplete.select(); // preselect the first entry, as the old popup did

    // The chat input sits at the bottom of the screen, so open the menu upwards
    const menu = this._autocomplete.element as HTMLElement | null;
    if (menu) {
      const { top } = target.getBoundingClientRect();
      menu.style.top = `${Math.max(0, top - menu.offsetHeight)}px`;
    }
  }

  _toEntry(e: EmojiRecord) {
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
    return {
      identifier: e.url ? `:${e.emoji}:` : e.emoji,
      label
    };
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
