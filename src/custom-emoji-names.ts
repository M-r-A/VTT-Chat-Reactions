/**
 * The name a custom emoji gets from its file: "Party%20Parrot.gif" -> "Party_Parrot". Only the characters a chat
 * message can hold between colons are kept, which also keeps markup out of the picker: picmo puts names into its
 * HTML templates.
 */
export function nameFromFile(file: string): string {
  let base = file.split("/").pop() ?? "";
  try {
    base = decodeURIComponent(base);
  } catch {
    // not percent-encoded
  }
  base = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  return base.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "emoji";
}

/** The name, or the name with _2, _3… when another emoji has it already. */
export function freeName(name: string, taken: Set<string>): string {
  let free = name;
  for (let i = 2; taken.has(free.toLowerCase()); i++) free = `${name}_${i}`;
  return free;
}
