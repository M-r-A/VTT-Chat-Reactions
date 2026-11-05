// Configuration of the Foundry type definitions (fvtt-types) for this module
import "fvtt-types/configuration";

declare module "fvtt-types/configuration" {
  // The module reads game, its settings and its users from the init hook on
  interface AssumeHookRan {
    init: never;
  }

  // Hooks of other modules (socketlib, PopOut!), and the one the suggestions call before inserting an emoji, kept
  // from Emojule
  namespace Hooks {
    interface HookConfig {
      "socketlib.ready": () => void;
      "PopOut:loaded": (app: unknown, node: HTMLElement) => void;
      emojuleSelectEmoji: (label: string | undefined, element: HTMLElement) => boolean | void;
    }
  }

  // The reactions of a message, and when each user reacted, both as JSON strings: custom emoji keys are file paths,
  // and their dots would split a nested flag path
  interface FlagConfig {
    ChatMessage: {
      world: { emoji: string };
      chatreactions: { reactedAt: string };
    };
  }

  interface SettingConfig {
    "chatreactions.picker-background": string;
    "chatreactions.picker-font-color": string;
    "chatreactions.category-active-icon-color": string;
    "chatreactions.chat-reactions-directory": string;
    "chatreactions.emojipleter": boolean;
    "chatreactions.emojipleter-max-results": number;
    "chatreactions.compact-reaction-button": boolean;
    "chatreactions.compact-emoji-button": boolean;
    "chatreactions.max-recents": number;
    "chatreactions.show-preview": boolean;
    [category: `chatreactions.show-category-${string}`]: boolean;
  }
}
