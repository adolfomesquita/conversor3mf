import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes da biblioteca de conversão.
export default defineConfig({
  // O resumo do site importa a biblioteca por este alias (ver site/vite.config.ts).
  resolve: { alias: { "@conversao": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["test/**/*.unidade.test.ts"],
    testTimeout: 60_000,
  },
});
