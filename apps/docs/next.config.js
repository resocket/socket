const withNextra = require("nextra")({
  theme: "nextra-theme-docs",
  themeConfig: "./theme.config.jsx",
  latex: true,
  flexsearch: {
    codeblocks: false,
  },
  defaultShowCopyCode: true,
});

module.exports = withNextra({
  output: "export",
  images: {
    unoptimized: true,
  },
});
