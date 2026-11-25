// Site estático (GitHub Pages): a conversão roda inteira no navegador, num Worker, com a biblioteca
// de ../conversao. O código Node da biblioteca (stream, Buffer) roda no navegador pelos polyfills.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { fileURLToPath } from "node:url";

const local = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const CONVERSAO = local("../conversao/src");
// zlib fica de fora: usamos a compressão nativa do navegador (src/zlibNavegador.ts).
const polyfills = () => nodePolyfills({ protocolImports: true, exclude: ["zlib"], globals: { Buffer: true, process: true, global: true } });

export default defineConfig({
  // Caminhos relativos: funciona em https://<usuario>.github.io/<repositorio>/ sem saber o nome.
  base: "./",
  plugins: [react(), polyfills()],
  worker: { format: "es", plugins: () => [polyfills()] },
  resolve: {
    alias: [
      { find: "@conversao", replacement: CONVERSAO },
      { find: /^(node:)?zlib$/, replacement: local("./src/zlibNavegador.ts") },
      // Os polyfills são injetados também nos arquivos da biblioteca (em ../conversao), cujo node_modules
      // não tem o plugin: aponta os shims para a cópia instalada aqui.
      ...["buffer", "process", "global"].map((n) => ({
        find: new RegExp(`^vite-plugin-node-polyfills/shims/${n}$`),
        replacement: local(`./node_modules/vite-plugin-node-polyfills/shims/${n}/dist/index.js`),
      })),
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: {
      allow: [
        local("."),
        CONVERSAO,
        local("../conversao/node_modules"),
        // Só no desenvolvimento: pasta local com cópias de projetos para comparar com a versão Node
        // (ver scripts/referencia-navegador.mjs).
        ...(process.env.AMOSTRAS_PAGINAS_DIR ? [process.env.AMOSTRAS_PAGINAS_DIR] : []),
      ],
    },
  },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
  build: { sourcemap: false },
});
