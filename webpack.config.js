/* eslint-disable */
const CopyPlugin = require("copy-webpack-plugin");
const ESLintPlugin = require("eslint-webpack-plugin");
const path = require("path");

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
            publicPath: '',
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
                    type: 'asset/resource',
                  },
            ],
        },
        plugins: [
            new ESLintPlugin({
                extensions: ["ts"],
            }),
            new CopyPlugin({
                patterns: [{
                    from: "static",
                    noErrorOnMissing: true,
                    // Ship static files as-is: production minifiers would rewrite module.css
                    info: { minimized: true },
                }],
            }),
        ],
    };

    if (!isDevelopment) {
        delete config.devtool;
    }

    return config;
};
