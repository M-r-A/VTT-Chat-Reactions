import { createPopup, PopupPickerController } from "@picmo/popup-picker";
import { TwemojiRenderer } from "@picmo/renderer-twemoji";
import utils from "./utils";

import { toCodePoints } from "./common";
import createEmojiPleter, { AutocompleteEmojiPleter, EmojiPleter } from "./emojipleter";
import {
  attachReactionCard, formatCount, formatReactionTime, hideReactionCard, readReactedAt, sortReactions
} from "./reaction-card";
import { renderMessageEmojis } from "./message-emojis";
declare global {
    interface LenientGlobalVariableTypes {
        game: never;
    }
}

let socket;

let picker: PopupPickerController;
let popoutPicker: PopupPickerController; // Picker especially for the PopOut! module windows
let currentMessage;
let chatInputView; // ProseMirror EditorView of the chat input
let emojiPleter: EmojiPleter | undefined;
const emojiDirectories: any = [];
const customEmojis: any = [];
let fileBrowserDenied = false; // a custom emoji folder could not be read: the user may not browse files
let categories = ['recents', 'custom', 'smileys-emotion', 'people-body', 'animals-nature', 'food-drink', 'activities', 'travel-places', 'objects', 'symbols', 'flags'];

Hooks.once("socketlib.ready", () => {
  // Setup Socket Lib for GM ability to add Chat Reactions
  // @ts-ignore
  socket = socketlib.registerModule("chatreactions");
  // @ts-ignore
  socket.register("handleReaction", handleReaction);
});

// Default picker colors. They carry the "#": v13+ cores JSON.parse string settings, so a bare "782e22" would come
// back as the number "7.82e+24".
const PICKER_COLORS = {
  "picker-background": "#d2d2c6",
  "picker-font-color": "#000000",
  "category-active-icon-color": "#782e22",
};

type PickerColor = keyof typeof PICKER_COLORS;

// A stored or entered color as "#rrggbb", or undefined when it is not a hex color (such as "7.82e+24").
// Earlier versions stored the colors without "#".
function normalizeColor(value): string | undefined {
  const hex = String(value?.css ?? value ?? "").replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : undefined;
}

// A picker color as 6 hex digits without the "#", falling back to the default. The color field gives a Color on
// v13+ and the stored string on v12.
function pickerColor(key: PickerColor): string {
  let value;
  try {
    value = game.settings.get("chatreactions", key);
  } catch {
    value = undefined;
  }
  return (normalizeColor(value) ?? PICKER_COLORS[key]).slice(1);
}

// Picker colors use the core color field, which shows a color picker in the settings
function registerPickerColor(key: PickerColor, name: string, hint: string) {
  game.settings.register("chatreactions", key, {
    name,
    hint,
    scope: "world",
    config: true,
    type: new (foundry as any).data.fields.ColorField({ nullable: false, initial: PICKER_COLORS[key] }),
    default: PICKER_COLORS[key],
    onChange: (_value, options) => {
      if (!options?.chatReactionsMigration) window.location.reload();
    },
  } as any);
}

// The color field only accepts "#rrggbb". Values stored by earlier versions ("d2d2c6", or "7.82e+24" after the core
// JSON-parsed "782e22") are rewritten once by the active GM, without reloading anyone.
async function migratePickerColors() {
  if (!game.user?.isGM || (game.users as any)?.activeGM !== game.user) return;
  const stored = (game.settings as any).storage.get("world");
  for (const key of Object.keys(PICKER_COLORS) as PickerColor[]) {
    const setting = stored.find((s) => s.key === `chatreactions.${key}`);
    if (!setting) continue;
    let raw = setting._source.value;
    try {
      raw = JSON.parse(raw);
    } catch {
      // stored as plain text
    }
    const value = normalizeColor(raw) ?? PICKER_COLORS[key];
    // The options reach onChange, which then skips the reload; the bundled v9 types do not know this argument
    if (value !== raw) await (game.settings as any).set("chatreactions", key, value, { chatReactionsMigration: true });
  }
}

Hooks.once("init", async () => {
  console.log(
    "===========================♥ Chat  Reactions ♥=========================="
  );

  // Helpers other modules (and the tests) can use: game.modules.get("chatreactions").api
  (game.modules.get("chatreactions") as any).api = { formatCount, formatReactionTime, sortReactions };

  // Go through the active modules to find Emoji Packs to add. Packages are identified by id (name before v10).
  // Packs declare their folder in the emojiPack flag; earlier versions read emojiPacker, which still works.
  game.modules.forEach((module: any) => {
    const packDirectory = module.flags?.emojiPack ?? module.flags?.emojiPacker;
    if (!module.active || !packDirectory) return;
    console.log(`\nChat Reactions found ${module.title}\n`);
    emojiDirectories.push(`modules/${module.id}${packDirectory}`);
  });

  for (const directory of emojiDirectories) {
    await loadDirectory(directory);
  }

  // Store the custom emoji directory for loading up all them delciious emojis
  game.settings.register("chatreactions", "chat-reactions-directory", {
    name: utils.localize("settings.chatReactionsDirectory.name"),
    hint: utils.localize("settings.chatReactionsDirectory.hint"),
    scope: "world",
    config: true,
    type: String,
    //@ts-ignore -- core renders a folder picker button for this option
    filePicker: "folder",
    default: "",
    onChange: () => {
      window.location.reload();
    },
  });

  game.settings.register("chatreactions", "emojipleter", {
    name: utils.localize("settings.emojipleter.name"),
    hint: utils.localize("settings.emojipleter.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      window.location.reload();
    }
  });

  game.settings.register("chatreactions", "emojipleter-max-results", {
    name: utils.localize("settings.emojipleterMaxResults.name"),
    hint: utils.localize("settings.emojipleterMaxResults.hint"),
    scope: "client",
    config: true,
    type: Number,
    default: 13,
    onChange: () => {
      window.location.reload();
    }
  })

  game.settings.register("chatreactions", "compact-reaction-button", {
    name: utils.localize("settings.compactReactionButton.name"),
    hint: utils.localize("settings.compactReactionButton.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      window.location.reload();
    }
  });

  game.settings.register("chatreactions", "compact-emoji-button", {
    name: utils.localize("settings.compactEmojiButton.name"),
    hint: utils.localize("settings.compactEmojiButton.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      window.location.reload();
    }
  });

  registerPickerColor("picker-background", "Background color for the picker",
    "Background color that will appear behind the emoji picker");
  registerPickerColor("picker-font-color", "Font color for the picker",
    "Color used in the text for the emoji picker. This color will be contrasted for headers");
  registerPickerColor("category-active-icon-color", "Font color for the active icon/category",
    "Color for the active icon/category. This color will be contrasted for inactive");

  game.settings.register("chatreactions", "max-recents", {
    name: "Max recent emojis",
    hint: "Max number of recent emojis to store.",
    scope: "client",
    config: true,
    type: Number,
    default: 50,
    onChange: () => {
      window.location.reload();
    }
  });

  game.settings.register("chatreactions", "show-preview", {
    name: "Show preview",
    hint: "Show a preview of the emoji when hovering over it in the picker.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      window.location.reload();
    }
  })

  // Allow the GM to choose which categories to show
  for (const category of categories) {
    game.settings.register("chatreactions", `show-category-${category}`, {
      name: `Show Category: ${category}`,
      hint: `Show emojis of the ${category} category in the emoji picker.`,
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => {
        window.location.reload();
      },
    });
  }
  categories = categories.filter((category) => game.settings.get("chatreactions", `show-category-${category}`))

  if (game.settings.get("chatreactions", "emojipleter"))
    emojiPleter = createEmojiPleter(customEmojis, game.settings.get("chatreactions", "emojipleter-max-results"));

  //   --category-button-color

  // --category-button-active-color

  // Allow GM to upload custom emojis
  // game.settings.register("chatreactions", "upload-to-directory", {
  //   name: "Upload Custom Emojis",
  //   hint: "",
  //   scope: "world",
  //   config: true,
  //   //@ts-ignore
  //   type: ImagePicker.Img,
  //   onChange: () => {
  //     window.location.reload();
  //   },
  // });

  const directory = game.settings.get("chatreactions", "chat-reactions-directory") as string;
  if (directory !== "") await loadDirectory(directory);

  picker = createPicker();

  const pickerCssRules = {
    "--background-color": `#${pickerColor("picker-background")}`,
    "--secondary-background-color": `#${pickerColor("picker-background")}`,
    "--category-name-background-color": `#${pickerColor("picker-background")}`,
    "--category-name-text-color": `#${pickerColor("picker-font-color")}75`,
    "--text-color": `#${pickerColor("picker-font-color")}`,
    "--secondary-text-color": `#${pickerColor("picker-font-color")}75`,
    "--category-tab-color": `#${pickerColor("category-active-icon-color")}75`,
    "--category-tab-active-color": `#${pickerColor("category-active-icon-color")}`,
    "--hover-background-color": "#e7f3f8",
  };
  $("head").append(`<style class="emoji-picker__styles">.picmo__picker {${Object.entries(pickerCssRules).map(([key, value]) => `${key}: ${value};`).join("\n")}}</style>`);
});

Hooks.once("ready", () => {
  migratePickerColors();

  // Everyone learns about custom emojis (a player may point the GM at the setting), once per connection and only in
  // the console: a notification on every load could not be turned off
  if (game.settings.get("chatreactions", "chat-reactions-directory") === "") {
    console.warn(utils.localize("warnings.noDirectory"));
  }
  // Users who cannot browse files cannot load the custom emoji folder or emoji packs: one console warning for all
  // of them, instead of a notification per folder on every load
  if (fileBrowserDenied) {
    console.warn(game.i18n.format("chatreactions.warnings.noFileBrowser",
      { permission: game.i18n.localize("PERMISSION.FilesBrowse") }));
  }
});

function onEmojiInput(selection) {
    // `selection` object has an `emoji` property
    // containing the selected emoji
    if (currentMessage === null) {
      insertIntoChatInput(selection.hexcode ? selection.emoji : `:${selection.emoji}:`);
    } else {
      //@ts-ignore
      if (!selection.hexcode) {
        socketExecute(selection.url, currentMessage);
      } else {
        socketExecute(selection.emoji, currentMessage);
      }
    }
  }

function createPicker(rootElement: HTMLElement = document.body) {
  const newPicker = createPopup({
    rootElement: rootElement,
    renderer: new TwemojiRenderer(),
    emojiVersion: 14,
    custom: customEmojis,
    categories: categories as any,
    initialCategory: "recents",
    maxRecents: game.settings.get("chatreactions", "max-recents") as number,
    showPreview: game.settings.get("chatreactions", "show-preview") as boolean,
  }, {
    showCloseButton: true,
    onPositionLost: "close",
    position: rootElement == document.body ? "auto" : "left",
  });
  newPicker.addEventListener("emoji:select", onEmojiInput);
  return newPicker;
}

// Insert text at the cursor of the chat input: a ProseMirror editor in v14, a textarea before
function insertIntoChatInput(text: string) {
  const view = chatInputView;
  if (view) {
    view.dispatch(view.state.tr.insertText(text));
    view.focus();
    return;
  }
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea#chat-message");
  if (!textarea) return;
  textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, "end");
  textarea.focus();
}

async function socketExecute(emoji, message) {
  try {
    await socket.executeAsGM(
      "handleReaction",
      emoji,
      message.id,
      game.user?.id
    );
  } catch (error) {
    console.log(error);
    if (game.scenes?.["current"] === undefined) {
      ui.notifications?.warn(
        "Please make sure a scene is loaded before reacting to messages"
      );
    } else {
      ui.notifications?.warn(
        "Due to foundry limitations, a GM needs to be online to use chat reactions"
      );
    }
  }
}

// Reactions to a message are applied one after another: each one reads the flag the previous one wrote, so quick
// reactions from several users no longer overwrite each other
const reactionQueues = new Map<string, Promise<void>>();

function handleReaction(emoji: string, sentMessageID: string, user: string) {
  const previous = reactionQueues.get(sentMessageID) ?? Promise.resolve();
  // A failed write is logged on the GM and does not stop the queue
  const queued = previous.then(() => applyReaction(emoji, sentMessageID, user))
    .catch((error) => console.error("Chat Reactions:", error));
  reactionQueues.set(sentMessageID, queued);
  queued.then(() => {
    if (reactionQueues.get(sentMessageID) === queued) reactionQueues.delete(sentMessageID);
  });
  return queued;
}

async function applyReaction(emoji: string, sentMessageID: string, user: string) {
  let currentEmojiState = {};

  // Get Current State of Emojis if it exists
  const sentMessage = game.messages?.get(sentMessageID);
  if (sentMessage?.getFlag("world", "emoji")) {
    currentEmojiState = JSON.parse(
      sentMessage?.getFlag("world", "emoji") as string
    );
  }

  // When each user reacted, kept beside the reactions (GM clock)
  const reactedAt = readReactedAt(sentMessage);

  // Reaction Logic
  if (currentEmojiState[emoji]) {
    if (currentEmojiState[emoji].includes(user)) {
      currentEmojiState[emoji] = currentEmojiState[
        emoji
      ].filter(function (value) {
        return value != user;
      });
      if (currentEmojiState[emoji].length === 0) {
        delete currentEmojiState[emoji];
      }
      delete reactedAt[emoji]?.[user];
      if (reactedAt[emoji] && Object.keys(reactedAt[emoji]).length === 0) delete reactedAt[emoji];
    } else {
      currentEmojiState[emoji].push(user);
      (reactedAt[emoji] ??= {})[user] = Date.now();
    }
  } else {
    currentEmojiState[emoji] = [user];
    (reactedAt[emoji] ??= {})[user] = Date.now();
  }
  // One update for both flags, so clients never render reactions without their times
  await sentMessage?.update({
    flags: {
      world: { emoji: JSON.stringify(currentEmojiState) },
      chatreactions: { reactedAt: JSON.stringify(reactedAt) },
    },
  } as any);
}

async function loadDirectory(directory: string) {
  const dir = utils.parseDirectory(directory);
  // v13+ FilePicker is an ApplicationV2 in foundry.applications.apps; v12 has the global one
  const Picker = (foundry as any).applications?.apps?.FilePicker?.implementation ?? FilePicker;
  await Picker.browse(
    dir.activeSource,
    dir.current,
    {
      bucket: dir.bucket,
    }
  ).then((fileList) => {
    // Load all the custom emojis from emoji packs
    addToCustomEmojiList(fileList, customEmojis);
  }).catch(() => {
    fileBrowserDenied = true; // reported once, in the console, when ready
  });
}

// Get all emoji image files from the directory and add them to the picker
function addToCustomEmojiList(fileList, customEmojis) {
  fileList["files"].forEach(function(value) {
    const name = `${value.split("/").pop(-1).split(".").slice(0, -1).join(".")}`.replace(/%20/g, " ");
    customEmojis.push({
      label: name,
      emoji: name.replace(/ /g, "_"),
      url: value,
    });
  });
}

function togglePicker(referenceEl: HTMLElement) {
  if (!document.contains(referenceEl) && popoutPicker)
    popoutPicker.toggle({
      triggerElement: referenceEl,
      referenceElement: referenceEl,
    });
  else
    picker.toggle({
      triggerElement: referenceEl,
      referenceElement: referenceEl,
    })
}

Hooks.on("PopOut:loaded", (_app, node: HTMLElement) => {
  if (node.querySelector("#chat-message")) { // Chat window has been popped out into a new window
    popoutPicker = createPicker(node);
    // Clone sprite sheet to new window so emojis won't be invisible
    if (node.querySelector("#picmo-twemoji-sprites")) return; // Already cloned
    const spriteSheet = document.getElementById("picmo-twemoji-sprites") as HTMLElement;
    node.appendChild(spriteSheet.cloneNode(true));
  }
});

// ProseMirror plugin for the chat input: keeps its view for inserting emojis and feeds the emojipleter
function buildChatInputPlugin() {
  const { Plugin } = (foundry as any).prosemirror.state;
  return new Plugin({
    view: (view) => {
      chatInputView = view;
      return {
        update: (updated) => {
          if (emojiPleter instanceof AutocompleteEmojiPleter) emojiPleter.onViewUpdate(updated);
        },
        destroy: () => {
          if (chatInputView === view) chatInputView = undefined;
          emojiPleter?.close();
        },
      };
    },
  });
}

// The chat input (<prose-mirror id="chat-message">) asks for its ProseMirror plugins with a bubbling "plugins" event
function onConfigurePlugins(event) {
  if (!event.target?.closest?.("#chat-message")) return;
  event.plugins.chatReactions = buildChatInputPlugin();
}

// Catches the first editor activation, which happens before renderChatInput
document.addEventListener("plugins", onConfigurePlugins);
const watchedChatInputs = new WeakSet<HTMLElement>();

Hooks.on("renderChatInput", (_app, elements: Record<string, HTMLElement>) => {
  // The input moves between the sidebar, the notifications area and other windows, so also listen on the element itself
  const input = elements["#chat-message"];
  if (input && !watchedChatInputs.has(input)) {
    watchedChatInputs.add(input);
    input.addEventListener("plugins", onConfigurePlugins);
  }

  const controls = elements["#chat-controls"];
  if (controls) addEmojiButton(controls);
});

// The core major version (12, 13, 14…); the bundled v9 types do not know release.generation
function coreGeneration(): number {
  return (game.release as any).generation;
}

// v12 has no renderChatInput: the chat log renders its own textarea and controls
Hooks.on("renderChatLog", (_app, html) => {
  if (coreGeneration() >= 13) return;
  const controls = (html[0] ?? html).querySelector("#chat-controls") as HTMLElement | null;
  if (!controls) return;
  // As in v2.3.5, the button sits with the GM's export/clear buttons, which players do not have
  let buttons = controls.querySelector<HTMLElement>(".control-buttons");
  if (!buttons) {
    buttons = document.createElement("div");
    buttons.className = "control-buttons";
    controls.append(buttons);
  }
  addEmojiButton(buttons);
});

// The emoji button next to the chat input
function addEmojiButton(container: HTMLElement) {
  if (container.querySelector(".chat-reactions-picker")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("chat-reactions-picker", "ui-control", "icon");
  if (game.settings.get("chatreactions", "compact-emoji-button")) {
    button.classList.add("fa-solid", "fa-face-smile");
  } else {
    button.innerHTML = `<svg class="emoji-image"><use xlink:href="#2795"></use></svg>`;
  }
  button.dataset.tooltip = "Add emoji"; // data-tooltip works from v12 on (data-tooltip-text only from v13)
  button.setAttribute("aria-label", "Add emoji");
  button.addEventListener("click", function () {
    togglePicker(button);
    currentMessage = null;
  });
  container.append(button);
}

// v13+ passes the message as an HTMLElement to renderChatMessageHTML; v12 only has renderChatMessage, with jQuery
Hooks.once("init", () => {
  if (coreGeneration() >= 13) Hooks.on("renderChatMessageHTML", renderMessage);
  else Hooks.on("renderChatMessage", (message, html) => renderMessage(message, html[0] ?? html));
});

// Logic for Button Styling and Rendering
function renderMessage(message, element: HTMLElement) {
  hideReactionCard(message.id); // its pill is being replaced

  const messagingElement = element.querySelector<HTMLElement>(".flavor-text") ?? element.querySelector<HTMLElement>(".message-content");
  if (!messagingElement) return;

  // Unicode emojis and known custom emoji codes in the text become images; the message's own markup stays as it is
  renderMessageEmojis(messagingElement, (name) => customEmojis.find((emoji) => emoji.emoji === name)?.url);

  let currentEmojiState = {};
  // Get current state of emojis
  if (message.getFlag("world", "emoji")) {
    currentEmojiState = JSON.parse(message.getFlag("world", "emoji") as string);
  }

  // Add All the reactions and render them accordingly as if the current user reacted or not
  const emojiRack = document.createElement("div");
  emojiRack.className = "chat-reactions-rack";
  for (const [key, value] of sortReactions(currentEmojiState, readReactedAt(message))) {
    let isvoted = false;
    const button = document.createElement("button");
    button.dataset.emoji = key;
    const voters = value as Array<string>;
    voters.forEach((voter) => {
      if (game.user?.id == voter) {
        isvoted = true;
      }
    });
    const ButtonContent = document.createElement("div");
    const EmojiReactions = document.createElement("p");
    EmojiReactions.textContent = formatCount(voters.length);
    if (key.includes("/")) { // Custom emoji
      const EmojiImage = document.createElement("img");
      EmojiImage.className = "emoji-image";
      EmojiImage.src = key;
      ButtonContent.appendChild(EmojiImage);
    } else {
      ButtonContent.innerHTML += `<svg class="emoji-image"><use xlink:href="#${toCodePoints(key).join('-')}"></use></svg>`;
    }
    ButtonContent.className = "emoji-button-content";
    ButtonContent.appendChild(EmojiReactions);
    button.appendChild(ButtonContent);
    // Core v13+ styles disable pointer events on the children of buttons, so the button itself takes the hover and click.
    // Who reacted and when shows in the reaction card; screen readers get the names.
    button.setAttribute("aria-label", voters.map((userId) => game.users?.get(userId)?.name ?? "?").join(", "));
    if (isvoted) {
      button.className = "emoji-button emoji-active ";
    } else {
      button.className = "emoji-button reaction";
    }
    attachReactionCard(button, message, key, voters);
    button.addEventListener("click", function () {
      //@ts-ignore
      socketExecute(
        key,
        message
      );
    });
    emojiRack.appendChild(button);
  }

  // Create the compact emoji button
  if (game.settings.get("chatreactions", "compact-reaction-button")) {
    const compactButton = document.createElement("a");
    compactButton.className = "compact-reaction-button";
    compactButton.innerHTML = "<i class='fas fa-smile'></i>";
    element.querySelector(".message-metadata")?.appendChild(compactButton);

    compactButton.addEventListener("click", function() {
      togglePicker(compactButton);
      currentMessage = message;
    });
    if (Object.keys(currentEmojiState).length === 0) return;
  }

  // Create Picker Button and add it to the Emoji Rack
  if (Object.entries(currentEmojiState).length < 4) {
    const p = document.createElement("button");
    p.innerHTML += `<svg class="emoji-image"><use xlink:href="#2795"></use></svg>`;
    p.className += "emoji-button trigger";

    p.addEventListener("click", function() {
      togglePicker(p);
      currentMessage = message;
    });
    emojiRack.appendChild(p);
  }
  element.appendChild(emojiRack);
}
