import { parse } from "twemoji-parser";

/** Reactions of a message: emoji (or custom emoji image path) -> ids of the users who reacted. */
export type Reactions = Record<string, string[]>;

/** Longer keys are not reactions: a single emoji or an image path is far shorter. */
export const MAX_REACTION_LENGTH = 512;

/**
 * The reactions stored in a message (flags.world.emoji, a JSON string). Anything that is not a list of user ids is
 * left out, and the object has no prototype, so keys such as "__proto__" are plain keys.
 */
export function readReactions(message): Reactions {
  const reactions: Reactions = Object.create(null);
  let stored;
  try {
    stored = JSON.parse(message?.getFlag("world", "emoji") ?? "{}");
  } catch {
    return reactions;
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return reactions;
  for (const [key, voters] of Object.entries(stored)) {
    if (typeof key !== "string" || key.length > MAX_REACTION_LENGTH || !Array.isArray(voters)) continue;
    const ids = voters.filter((id) => typeof id === "string");
    if (ids.length) reactions[key] = ids;
  }
  return reactions;
}

/** Whether a key is exactly one unicode emoji, as the picker sends them. */
export function isUnicodeEmoji(key: unknown): key is string {
  if (typeof key !== "string" || !key || key.length > 64) return false;
  const entities = parse(key);
  return entities.length === 1 && entities[0].text === key;
}

/**
 * A path of this world's server: no scheme, not protocol-relative, an image file. Custom emojis are files of the
 * custom emoji folder or of emoji pack modules.
 */
export function isLocalImagePath(key: unknown): key is string {
  return typeof key === "string" && key.length <= MAX_REACTION_LENGTH
    && !/^[a-z][a-z0-9+.-]*:/i.test(key) && !key.startsWith("//") && !key.startsWith("\\")
    && !/["'<>\s\\]/.test(key)
    && /\.(png|gif|webp|jpe?g|avif|svg)$/i.test(key);
}
