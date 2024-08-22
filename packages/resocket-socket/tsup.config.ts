import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/react.tsx"],
  dts: true,
  splitting: true,
  clean: true,
  minify: true,
  target: "esnext",
  format: ["esm", "cjs"],
  external: ["react"],
  sourcemap: true,
});
