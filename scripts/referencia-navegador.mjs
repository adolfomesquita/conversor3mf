#!/usr/bin/env node
// Referência no Node para comparar com a conversão no navegador (o site).
// Converte projetos com a biblioteca compilada (conversao/lib) e grava, por arquivo, os nomes e o
// SHA-256 do conteúdo de cada entrada do .3mf convertido e o relatório, em <pasta>/referencia.json.
//
// Uso (depois de `npm --prefix conversao run build`):
//   node scripts/referencia-navegador.mjs <pasta> '[["a1.3mf","creality-k1c"],["a2.3mf","snapmaker-u1"]]'
// Depois: AMOSTRAS_PAGINAS_DIR=<pasta> npm run dev e, no console da página,
//   await __rodar("/@fs/<pasta>/", [["a1.3mf","creality-k1c"], ...])
// Use cópias dos projetos numa pasta FORA do repositório (podem ser de terceiros).
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const raiz = new URL("../", import.meta.url);
const req = createRequire(new URL("conversao/package.json", raiz));
const yauzl = req("yauzl");
const { converterProjeto } = await import(new URL("conversao/lib/converter.js", raiz).href);
const PASTA = process.argv[2];
const CASOS = JSON.parse(process.argv[3] ?? "[]");
if (!PASTA || CASOS.length === 0) {
  console.error("Uso: node scripts/referencia-navegador.mjs <pasta> '[[\"arquivo.3mf\",\"modelo-id\"]]'");
  process.exit(1);
}
function hashes(caminho) {
  return new Promise((resolve, reject) => {
    const out = { nomes: [], hashes: {} };
    yauzl.open(caminho, { lazyEntries: true }, (e, z) => {
      if (e) return reject(e);
      z.on("entry", (en) => {
        if (en.fileName.endsWith("/")) return z.readEntry();
        out.nomes.push(en.fileName);
        z.openReadStream(en, (e2, s) => {
          const h = createHash("sha256");
          s.on("data", (d) => h.update(d));
          s.on("end", () => { out.hashes[en.fileName] = h.digest("hex"); z.readEntry(); });
        });
      });
      z.on("end", () => resolve(out));
      z.readEntry();
    });
  });
}
const res = {};
for (const [arq, modeloId] of CASOS) {
  const t = Date.now();
  try {
    const r = await converterProjeto({ entrada: `${PASTA}/${arq}`, saida: `${PASTA}/saida-${arq}`, modeloId });
    const ms = Date.now() - t;
    res[arq] = { tipo: "ok", ms, bytes: r.bytesSaida, ...(await hashes(`${PASTA}/saida-${arq}`)), relatorio: r.relatorio };
  } catch (e) {
    res[arq] = { tipo: "erro", codigo: e.codigo, mensagem: e.message };
  }
  console.log(arq, modeloId, res[arq].tipo, res[arq].ms ?? res[arq].codigo);
}
writeFileSync(`${PASTA}/referencia.json`, JSON.stringify(res));
