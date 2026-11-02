import { TemplatePreloader } from "./module/helper/TemplatePreloader";
import { createPopup, PopupPickerController } from "@picmo/popup-picker";
import { TwemojiRenderer } from "@picmo/renderer-twemoji";
import utils from "./utils";
import { parse } from "twemoji-parser";

import { toCodePoints } from "./common";
import createEmojiPleter, { AutocompleteEmojiPleter, EmojiPleter } from "./emojipleter";

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
let categories = ['recents', 'custom', 'smileys-emotion', 'people-body', 'animals-nature', 'food-drink', 'activities', 'travel-places', 'objects', 'symbols', 'flags'];

Hooks.once("socketlib.ready", () => {
  // Setup Socket Lib for GM ability to add Chat Reactions
  // @ts-ignore
  socket = socketlib.registerModule("chatreactions");
  // @ts-ignore
  socket.register("handleReaction", handleReaction);
});

function isHexColor(hex) {
  const x =
    typeof hex === "string" && hex.length === 6 && !isNaN(Number("0x" + hex));
  if (x) {
    picker = createPicker();
  }
  return x;
}

Hooks.once("init", async () => {
  console.log(
    "===========================♥ Chat  Reactions ♥=========================="
  );

  const modules = await game.modules;
  modules.forEach((module) => {
    // Go through all modules to find Emoji Packs to add
    if (module["flags"]?.["emojiPacker"]) {
      console.log(`\nChat Reactions found ${module["title"]}\n`);
      emojiDirectories.push(
        `modules/${module["name"]}${module["flags"]?.["emojiPacker"]}`
      );
    }
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

  game.settings.register("chatreactions", "picker-background", {
    name: "Background color for the picker ",
    hint: "Background color in hex that will appear behind the emoji picker",
    scope: "world",
    config: true,
    type: String,
    default: "d2d2c6",
    onChange: (value) => {
      if(isHexColor(value)){
        window.location.reload()
      }
      else {
        ui.notifications?.warn(
          "The value provided is NOT a hex value"
        );
      }
    },
  });

  game.settings.register("chatreactions", "picker-font-color", {
    name: "Font color for the picker",
    hint:
      "Hex color used in the text for the emoji picker. This color will be contrasted for headers",
    scope: "world",
    config: true,
    type: String,
    default: "000000",
    onChange: (value) => {
      if(isHexColor(value)){
        window.location.reload()
      }
      else {
        ui.notifications?.warn(
          "The value provided is NOT a hex value"
        );
      }
    },
  });

  game.settings.register("chatreactions", "category-active-icon-color", {
    name: "Font color for the active icon/category",
    hint:
      "Font color for the active icon/category. This color will be contrasted for inactive",
    scope: "world",
    config: true,
    type: String,
    default: "782e22",
    onChange: (value) => {
      if(isHexColor(value)){
        window.location.reload()
      }
      else {
        ui.notifications?.warn(
          "The value provided is NOT a hex value"
        );
      }
    },
  });

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

  // Warn User/GM if the directory isnt defined
  if (game.settings.get("chatreactions", "chat-reactions-directory") === "") {
    ui.notifications?.warn(
      "The Emoji Reactions module supports custom emojis, Please setup a custom directory to add them!"
    );
  } else {
    await loadDirectory(game.settings.get("chatreactions", "chat-reactions-directory") as string);
  }

  picker = createPicker();

  const pickerCssRules = {
    "--background-color": `#${game.settings.get(
      "chatreactions",
      "picker-background"
    )}`,
    "--secondary-background-color": `#${game.settings.get(
        "chatreactions",
        "picker-background"
    )}`,
    "--category-name-background-color": `#${game.settings.get(
        "chatreactions",
        "picker-background"
    )}`,
    "--category-name-text-color": `#${game.settings.get(
        "chatreactions",
        "picker-font-color"
    )}75`,
    "--text-color": `#${game.settings.get(
      "chatreactions",
      "picker-font-color"
    )}`,
    "--secondary-text-color": `#${game.settings.get(
      "chatreactions",
      "picker-font-color"
    )}75`,
    "--category-tab-color": `#${game.settings.get(
      "chatreactions",
      "category-active-icon-color"
    )}75`,
    "--category-tab-active-color": `#${game.settings.get(
      "chatreactions",
      "category-active-icon-color"
    )}`,
    "--hover-background-color": "#e7f3f8",
  };
  $("head").append(`<style class="emoji-picker__styles">.picmo__picker {${Object.entries(pickerCssRules).map(([key, value]) => `${key}: ${value};`).join("\n")}}</style>`);
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

function handleReaction(emoji: string, sentMessageID: string, user: string) {
  let currentEmojiState = {};

  // Get Current State of Emojis if it exists
  const sentMessage = game.messages?.get(sentMessageID);
  if (sentMessage?.getFlag("world", "emoji")) {
    currentEmojiState = JSON.parse(
      sentMessage?.getFlag("world", "emoji") as string
    );
  }

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
    } else {
      currentEmojiState[emoji].push(user);
    }
  } else {
    currentEmojiState[emoji] = [user];
  }
  sentMessage?.setFlag("world", "emoji", JSON.stringify(currentEmojiState));
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
    Hooks.once("ready", () => {
      ui.notifications?.warn("Chat Reactions: The GM must give you permission to use the file browser for you to use emoji packs.");
    });
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
  const messagingElement = element.querySelector<HTMLElement>(".flavor-text") ?? element.querySelector<HTMLElement>(".message-content");
  if (!messagingElement) return;

  const emojiData = parse(messagingElement.innerText);
  emojiData.forEach((emoji) => {
    const splitText = messagingElement.innerHTML.split(emoji.text);
    messagingElement.innerHTML = "";
    splitText.forEach((text, index) => {
      messagingElement.innerHTML += text;
      if (emoji.url && index < splitText.length - 1) {
        messagingElement.innerHTML += `<svg class="twemoji emoji"><use xlink:href="#${toCodePoints(emoji.text).join('-')}"></use></svg>`;
      }
    });
  });
  const match = new RegExp(":[a-zA-Z0-9_]*:");
  let matchResult = match.exec(messagingElement.innerHTML);

  while (matchResult != null) {
    const result = customEmojis.filter((customEmoji) => {
      //@ts-ignore
      return customEmoji.emoji === matchResult[0].replace(/:/g, "");
    });
    if (result.length > 0) {
      messagingElement.innerHTML = messagingElement.innerHTML.replace(
        matchResult[0],
        `<img class="emoji" src="${
          result[0].url
        }"/>`
      );
    } else {
      messagingElement.innerHTML = messagingElement.innerHTML.replace(
        matchResult[0],
        matchResult[0].replace(/:/g, "") 
      );
    }

    matchResult = match.exec(messagingElement.innerHTML);
  }
 
  const regex = /^\s*$/;
  if (messagingElement.innerText.replace(regex, "") === "") {
    for (let i = 0; i < messagingElement.children.length; i++) {
      if(messagingElement.children[i].classList.contains("emoji")){
        messagingElement.children[i].classList.add("emoji-large")
      }
    }
  }

  let currentEmojiState = {};
  // Get current state of emojis
  if (message.getFlag("world", "emoji")) {
    currentEmojiState = JSON.parse(message.getFlag("world", "emoji") as string);
  }

  // Add All the reactions and render them accordingly as if the current user reacted or not
  const emojiRack = document.createElement("div");
  emojiRack.className = "chat-reactions-rack";
  for (const [key, value] of Object.entries(currentEmojiState)) {
    let isvoted = false;
    const button = document.createElement("button");
    const voters = value as Array<string>;
    voters.forEach((voter) => {
      if (game.user?.id == voter) {
        isvoted = true;
      }
    });
    const ButtonContent = document.createElement("div");
    const EmojiReactions = document.createElement("p");
    EmojiReactions.textContent = `${voters.length}`;
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
    // Core v13+ styles disable pointer events on the children of buttons, so the button itself takes the hover and click
    button.title = voters.map((userId) => game.users?.get(userId)?.name).join(", ");
    if (isvoted) {
      button.className = "emoji-button emoji-active ";
    } else {
      button.className = "emoji-button reaction";
    }
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

if (process.env.NODE_ENV === "development") {
  if (module.hot) {
    module.hot.accept();

    if (module.hot.status() === "apply") {
      for (const template in _templateCache) {
        if (Object.prototype.hasOwnProperty.call(_templateCache, template)) {
          delete _templateCache[template];
        }
      }

      TemplatePreloader.preloadHandlebarsTemplates().then(() => {
        for (const application in ui.windows) {
          if (Object.prototype.hasOwnProperty.call(ui.windows, application)) {
            ui.windows[application].render(true);
          }
        }
      });
    }
  }
}
