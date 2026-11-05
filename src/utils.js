const MODULE_NAME = "chatreactions";

const utils = {
  /**
   * Custom wrapper for localization, it adds the module name in front of the string
   * and returns the localize string
   */
  localize: (path) => {
    return game.i18n.localize(`${MODULE_NAME}.${path}`);
  },

  /**
   * Parse a stored directory setting into FilePicker browse options.
   * Accepts a plain path from the core folder picker, and the "[source] path" / "[s3:bucket] path" format
   * written by the old DirectoryPicker.
   */
  parseDirectory: (inStr) => {
    const str = inStr ?? "";
    const matches = str.match(/\[(.+)\]\s*(.+)?/u);
    if (matches) {
      const [, source, current = ""] = matches;
      const [activeSource, bucket = null] = source.split(":");
      return { activeSource, bucket, current: current.trim() };
    }
    return { activeSource: "data", bucket: null, current: str };
  },
};

export default utils;
