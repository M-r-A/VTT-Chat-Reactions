/* eslint-disable */
const CopyPlugin = require("copy-webpack-plugin");
const ESLintPlugin = require("eslint-webpack-plugin");
const fs = require("fs");
const path = require("path");

// The license of the Twemoji graphics in the sprite of @picmo/renderer-twemoji. Its package carries only the MIT
// license of its code.
const TWEMOJI_GRAPHICS = `Twemoji graphics
Copyright 2019 Twitter, Inc and other contributors
https://github.com/jdecked/twemoji
Graphics licensed under CC-BY 4.0: https://creativecommons.org/licenses/by/4.0/`;

/**
 * Writes THIRD-PARTY-NOTICES.txt next to chatreactions.js: the license file of every package bundled into it, and the
 * license of the Twemoji graphics. MIT and CC-BY 4.0 require these notices in the copies the module ships. The list
 * comes from the modules webpack actually bundled, so it follows the dependencies without upkeep.
 */
class ThirdPartyNoticesPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap("ThirdPartyNotices", (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: "ThirdPartyNotices", stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        () => {
          const roots = new Set();
          const collect = (module) => {
            if (module.modules) module.modules.forEach(collect); // modules concatenated in production
            const match = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/.exec(module.resource ?? "");
            if (match) roots.add(match[1]);
          };
          for (const module of compilation.modules) collect(module);
          // Packages may ship their own dependencies built into their files (picmo's popup carries
          // floating-ui, its renderer the twemoji parser), so their dependencies count as bundled too
          for (const root of roots) {
            const { dependencies = {} } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
            for (const name of Object.keys(dependencies)) {
              const nested = path.join(root, "node_modules", name);
              const hoisted = path.join(__dirname, "node_modules", name);
              const found = [nested, hoisted].find((dir) => fs.existsSync(path.join(dir, "package.json")));
              if (found) roots.add(found); // a Set visits entries added while iterating
            }
          }

          const notices = [...roots].map((root) => {
            const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
            const file = fs.readdirSync(root).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
            const text = file ? fs.readFileSync(path.join(root, file), "utf8").trim() : `License: ${pkg.license}`;
            return { name: pkg.name, text: `${pkg.name} ${pkg.version}\n\n${text}` };
          });
          notices.sort((a, b) => a.name.localeCompare(b.name));
          if (notices.some(({ name }) => name === "@picmo/renderer-twemoji")) {
            notices.push({ name: "Twemoji graphics", text: TWEMOJI_GRAPHICS });
          }
          const body = notices.map(({ text }) => text).join(`\n\n${"-".repeat(80)}\n\n`);
          compilation.emitAsset(
            "THIRD-PARTY-NOTICES.txt",
            new sources.RawSource(`Third-party software bundled into chatreactions.js\n\n${body}\n`),
          );
        },
      );
    });
  }
}

module.exports = (env) => {
  const defaults = {
    watch: false,
    mode: "development",
  };

  const environment = { ...defaults, ...env };
  const isDevelopment = environment.mode === "development";

  const config = {
    entry: "./src/chatreactions.ts",
    watch: environment.watch,
    devtool: "inline-source-map",
    stats: "minimal",
    mode: environment.mode,
    resolve: {
      extensions: [".wasm", ".mjs", ".ts", ".js", ".json"],
    },
    output: {
      filename: "chatreactions.js",
      path: path.resolve(__dirname, "dist"),
      publicPath: "",
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: ["ts-loader", "source-map-loader"],
        },
        {
          test: /\.(png|svg|jpg|jpeg|gif)$/i,
          type: "asset/resource",
        },
      ],
    },
    plugins: [
      new ESLintPlugin({
        extensions: ["ts"],
      }),
      new CopyPlugin({
        patterns: [
          {
            from: "static",
            noErrorOnMissing: true,
            // Ship static files as-is: production minifiers would rewrite module.css
            info: { minimized: true },
          },
          {
            from: "LICENSE",
          },
        ],
      }),
      new ThirdPartyNoticesPlugin(),
    ],
  };

  if (!isDevelopment) {
    delete config.devtool;
  }

  return config;
};
