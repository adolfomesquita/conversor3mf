#!/usr/bin/env node
// Copia os perfis-alvo (JSON) de src/ para lib/ no build (usado pelo script de referência, que roda
// a versão compilada no Node). O código os lê do disco sob demanda (src/perfis.ts).
import { cpSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origem = join(raiz, "src", "perfis");
const destino = join(raiz, "lib", "perfis");
cpSync(origem, destino, { recursive: true, filter: (p) => !p.includes("..") });
const n = readdirSync(destino).filter((f) => f.endsWith(".json")).length;
if (n < 2) throw new Error(`perfis não copiados para lib/ (${n})`);
