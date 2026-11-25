// Fotos das impressoras de ORIGEM (resumo do projeto no navegador) e índice de busca por modelo.
//
//   node conversao/scripts/gerar-capas-origem.mjs --orca "C:/caminho/do/clone/OrcaSlicer"
//
// - Copia <Fabricante>/<modelo>_cover.png do repositório oficial do OrcaSlicer (só modelos que não
//   são destino; os de destino, como Bambu Lab e Creality, já têm capa gerada por gerar-perfis.mjs)
//   (https://github.com/OrcaSlicer/OrcaSlicer) para site/public/impressoras/origem/, para as
//   fabricantes de FABRICANTES (as dos slicers de origem suportados que não são destinos).
// - Gera site/public/impressoras/origens.json: nome normalizado do modelo (printer_model do
//   projeto, ex.: "Bambu Lab P1S") -> arquivo. Inclui as impressoras de destino (capas já geradas
//   por gerar-perfis.mjs). O navegador só usa caminhos vindos deste índice.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const PUBLICO = join(aqui, "..", "..", "site", "public", "impressoras");
const SAIDA = join(PUBLICO, "origem");
const INDICE_PERFIS = join(aqui, "..", "src", "perfis", "indice.json");

/** Pasta no repositório do Orca -> prefixo do nome do modelo (removido para o apelido curto). */
const FABRICANTES = { Creality: "Creality" };

const args = process.argv.slice(2);
const iOrca = args.indexOf("--orca");
if (iOrca < 0 || !args[iOrca + 1]) {
  console.error('Uso: node conversao/scripts/gerar-capas-origem.mjs --orca "C:/caminho/do/clone/OrcaSlicer"');
  process.exit(1);
}
const orca = args[iOrca + 1];

const normalizar = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Nome completo -> arquivo; apelido (sem a fabricante, ex.: "K1C") -> arquivos possíveis. */
const completos = new Map();
const apelidos = new Map();
function registrar(nome, arquivo, prefixo) {
  completos.set(normalizar(nome), arquivo);
  if (prefixo && nome.startsWith(`${prefixo} `)) {
    const k = normalizar(nome.slice(prefixo.length + 1));
    if (!apelidos.has(k)) apelidos.set(k, new Set());
    apelidos.get(k).add(arquivo);
  }
}

// 1. Destinos (capas de gerar-perfis.mjs).
const perfis = JSON.parse(readFileSync(INDICE_PERFIS, "utf8"));
for (const m of perfis.modelos) if (m.capa) registrar(m.impressora, m.capa, m.fabricante);

// 2. Origens (do repositório do Orca).
mkdirSync(SAIDA, { recursive: true });
for (const nome of readdirSync(SAIDA)) if (nome.endsWith(".png")) unlinkSync(join(SAIDA, nome));
const copiadas = [];
for (const [pasta, prefixo] of Object.entries(FABRICANTES)) {
  const dir = join(orca, "resources", "profiles", pasta);
  if (!existsSync(dir)) {
    console.error(`Pasta ausente no clone: ${dir} (git sparse-checkout add resources/profiles/${pasta}/machine)`);
    process.exit(1);
  }
  for (const arq of readdirSync(dir).sort()) {
    const m = /^(.+)_cover\.png$/.exec(arq);
    // Variantes como "Creality K1C_CFS-C" não aparecem como printer_model; ficam de fora.
    if (!m || m[1].includes("_")) continue;
    // Modelo que também é destino (ex.: Creality pelo Creality Print) já usa a capa de destino.
    if (completos.has(normalizar(m[1]))) continue;
    const destino = `origem/${slug(m[1])}.png`;
    copyFileSync(join(dir, arq), join(PUBLICO, destino));
    registrar(m[1], destino, prefixo);
    copiadas.push(`- ${destino}: ${pasta}/${arq}`);
  }
}

// Apelido só entra se não for nome completo de outro modelo e apontar para um único arquivo.
const indice = new Map(completos);
for (const [k, arquivos] of apelidos) if (k && !indice.has(k) && arquivos.size === 1) indice.set(k, [...arquivos][0]);
const ordenado = Object.fromEntries([...indice.entries()].sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(PUBLICO, "origens.json"), `${JSON.stringify(ordenado, null, 1)}\n`);

let commit = "(desconhecido)";
try {
  commit = execFileSync("git", ["-C", orca, "log", "-1", "--format=%H %cs"], { encoding: "utf8" }).trim();
} catch {
  /* clone sem git */
}
writeFileSync(
  join(SAIDA, "ORIGEM.md"),
  [
    "# Imagens das impressoras de origem",
    "",
    "Copiadas por conversao/scripts/gerar-capas-origem.mjs do repositório oficial do OrcaSlicer.",
    "",
    "- Repositório: https://github.com/OrcaSlicer/OrcaSlicer",
    `- Commit: ${commit}`,
    "- Licença do repositório: GNU AGPL-3.0 (ver LICENSE.txt do repositório). As imagens provavelmente são das fabricantes.",
    "",
    ...copiadas,
    "",
  ].join("\n"),
);
console.log(`${copiadas.length} capas de origem; ${indice.size} chaves em origens.json.`);
