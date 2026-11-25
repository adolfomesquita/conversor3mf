#!/usr/bin/env node
// Gera os perfis-alvo achatados (src/perfis/<id>.json + indice.json) para TODOS os modelos
// de cada fabricante do catálogo, a partir dos perfis de sistema instalados com os slicers das
// fabricantes. Roda só em desenvolvimento; o resultado é versionado.
//
// Uso:
//   node scripts/gerar-perfis.mjs \
//     --raiz anycubic="C:/Program Files/AnycubicSlicerNext/resources/profiles" \
//     --raiz flashforge="C:/Program Files/Flashforge/Flash Studio Desktop/resources/profiles" \
//     --binario anycubic="C:/Program Files/AnycubicSlicerNext/AnycubicSlicer.dll" \
//     --binario flashforge="C:/Program Files/Flashforge/Flash Studio Desktop/Orca-Flashforge.dll" \
//     --capas "C:/caminho/do/clone/OrcaSlicer" \
//     --raiz bambu="C:/caminho/do/clone/BambuStudio/resources/profiles" \
//     --enums bambu="C:/caminho/do/clone/BambuStudio/src/libslic3r/PrintConfig.cpp" \
//     --raiz creality="C:/caminho/do/clone/CrealityPrint/resources/profiles" \
//     --enums creality="C:/caminho/do/clone/CrealityPrint/src/libslic3r/PrintConfig.cpp"
//
// Bambu Studio e Creality Print: perfis e enums dos repositórios oficiais
// (https://github.com/bambulab/BambuStudio, https://github.com/CrealityOfficial/CrealityPrint, na
// tag da versão pública do catálogo), os mesmos arquivos que os instaladores trazem. Com --enums,
// os tipos das opções desse PrintConfig.cpp também normalizam listas gravadas como texto.
//
// Para cada máquina (modelo + bico) do pacote de perfis da fabricante:
// - resolve a herança (`inherits`) da máquina, dos processos compatíveis e dos filamentos escolhidos;
// - escolhe os filamentos por tipo automaticamente (genérico primeiro), salvo "sobrescritas" do
//   catálogo (regras escritas à mão para perfis já conferidos num slicer real);
// - define o máximo de cores pela tabela "cores" do catálogo (com a fonte) ou pelo perfil;
// - grava a versão do pacote de perfis e do app de origem.
// --capas (clone do repositório oficial https://github.com/OrcaSlicer/OrcaSlicer):
// - imagens dos modelos (resources/profiles/<Fabricante>/<modelo>_cover.png); se o repositório não
//   tiver o modelo, usa a imagem do próprio slicer da fabricante. Origem registrada em ORIGEM.md;
// - src/libslic3r/PrintConfig.cpp: opções de lista fixa (enum). Com --binario, ficam só os valores
//   que existem na biblioteca do slicer de destino; somados aos usados nos perfis dele, formam
//   `valoresAceitos` (a conversão não grava valores que o slicer substituiria ao abrir).
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(aqui, "..", "src", "perfis");
const SAIDA_CAPAS = join(aqui, "..", "..", "site", "public", "impressoras");

const CHAVES_META = new Set([
  "name", "inherits", "from", "type", "instantiation", "setting_id", "filament_id", "base_id",
  "compatible_printers", "compatible_printers_condition", "compatible_prints", "compatible_prints_condition",
  "renamed_from", "version", "description", "is_custom_defined", "printer_settings_id",
  "print_settings_id", "filament_settings_id",
]);

/**
 * Tipo de filamento da origem (Bambu e família Orca) -> tipos procurados no destino, em ordem.
 * O primeiro é a equivalência exata; os seguintes são aproximações (marcadas para revisão).
 */
const TIPOS = {
  PLA: ["PLA"], "PLA+": ["PLA+", "PLA"], "PLA-S": ["PLA"], SILK: ["SILK", "PLA"],
  "PLA-CF": ["PLA-CF", "PLA"], "PLA-GF": ["PLA-CF", "PLA"],
  PETG: ["PETG"], PET: ["PETG"], "PETG-CF": ["PETG-CF", "PETG"], "PETG-GF": ["PETG-CF", "PETG"],
  "PET-CF": ["PET-CF", "PETG-CF", "PETG"], "PET-GF": ["PET-CF", "PETG-CF", "PETG"],
  ABS: ["ABS"], "ABS-GF": ["ABS-GF", "ABS"], "ABS-CF": ["ABS-GF", "ABS"],
  ASA: ["ASA"], "ASA-CF": ["ASA-CF", "ASA"], "ASA-GF": ["ASA-GF", "ASA"],
  TPU: ["TPU", "TPU-95A", "FLEX"], "TPU-AMS": ["TPU", "TPU-95A", "FLEX"], "TPU-95A": ["TPU-95A", "TPU", "FLEX"],
  "TPU-90A": ["TPU-90A", "TPU", "FLEX"], "TPU-64D": ["TPU-64D", "TPU"], FLEX: ["FLEX", "TPU", "TPU-95A"],
  PC: ["PC"], "PC-ABS": ["PC", "ABS"], "PC-CF": ["PC"],
  PA: ["PA", "PA-CF", "PA6-CF"], "PA-CF": ["PA-CF", "PA6-CF", "PA"], "PA6-CF": ["PA6-CF", "PA-CF"],
  "PAHT-CF": ["PAHT-CF", "PA-CF", "PA6-CF"], "PA12-CF": ["PA-CF", "PA6-CF"], "PA-GF": ["PA-CF", "PA6-CF"],
  PPS: ["PPS-CF"], "PPS-CF": ["PPS-CF"], "PPA-CF": ["PPA-CF"], "PPA-GF": ["PPA-GF"],
  PVA: ["PVA"], BVOH: ["BVOH"], HIPS: ["HIPS"], PEBA: ["PEBA"],
};
/** Aproximações que contam como equivalência exata (mesmo material, outro nome). */
const EXATOS = new Set(["PLA+>PLA", "PLA-S>PLA", "PET>PETG", "TPU>TPU-95A", "TPU-AMS>TPU", "TPU-AMS>TPU-95A", "FLEX>TPU", "FLEX>TPU-95A", "TPU-95A>TPU", "SILK>PLA"]);
/** Variantes especiais que não devem ser escolhidas como "o" filamento de um tipo. */
const ESPECIAL = /\b(HS|High Speed|Silk|Matte|Galaxy|Metal|Glow|Luminous|Wood|Marble|Translucent|Transparent|Clear|Sparkle|Color Change|LW|Pro|Rapid|Lite|Tough|Super|Ultra)\b/i;

let capas = null;
const binarios = {};
/** fork -> PrintConfig.cpp do próprio slicer de destino (código aberto, ex.: Bambu Studio). */
const enumsProprios = {};

function argumentos() {
  const raizes = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const par = () => {
      const [k, ...resto] = String(a[++i]).split("=");
      return [k, resto.join("=")];
    };
    if (a[i] === "--raiz") {
      const [k, v] = par();
      raizes[k] = v;
    } else if (a[i] === "--binario") {
      const [k, v] = par();
      binarios[k] = v;
    } else if (a[i] === "--enums") {
      const [k, v] = par();
      enumsProprios[k] = v;
    } else if (a[i] === "--capas") {
      capas = String(a[++i]);
    } else {
      throw new Error(`argumento desconhecido: ${a[i]}`);
    }
  }
  return raizes;
}

function listarJson(pasta) {
  const out = [];
  for (const nome of readdirSync(pasta)) {
    const p = join(pasta, nome);
    if (statSync(p).isDirectory()) out.push(...listarJson(p));
    else if (nome.endsWith(".json")) out.push(p);
  }
  return out;
}

function lerJson(p) {
  return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

function indexar(raiz, pastas) {
  const idx = new Map();
  for (const pasta of pastas) {
    for (const arq of listarJson(join(raiz, pasta))) {
      let j;
      try { j = lerJson(arq); } catch { continue; }
      if (j && typeof j === "object" && typeof j.name === "string" && !idx.has(j.name)) idx.set(j.name, j);
    }
  }
  return idx;
}

function resolver(idx, nome, cadeia = []) {
  const j = idx.get(nome);
  if (!j) throw new Error(`perfil não encontrado: "${nome}" (cadeia: ${cadeia.join(" <- ")})`);
  if (cadeia.includes(nome)) throw new Error(`herança circular em "${nome}"`);
  const base = j.inherits ? resolver(idx, j.inherits, [...cadeia, nome]) : {};
  return { ...base, ...j };
}

function resolverSeguro(idx, nome) {
  try { return resolver(idx, nome); } catch { return null; }
}

/** Tipos de opção (`coFloats`, `coString`...) do PrintConfig.cpp do slicer de destino. */
function tiposDoArquivo(caminho) {
  const out = {};
  const cpp = readFileSync(caminho, "utf8");
  for (const m of cpp.matchAll(/this->add(?:_nullable)?\(\s*"([^"]+)"\s*,\s*(co\w+)/g)) out[m[1]] = m[2];
  // Limites da máquina definidos por eixo: this->add("machine_max_speed_" + axis.name, coFloats).
  for (const m of cpp.matchAll(/this->add(?:_nullable)?\(\s*"([^"]+)"\s*\+\s*axis\.name\s*,\s*(co\w+)/g)) {
    for (const eixo of ["x", "y", "z", "e"]) out[m[1] + eixo] = m[2];
  }
  return out;
}

/** Opções de lista (um valor por extrusora/filamento): `coFloats`, `coPoints`, `coStrings`... */
const TIPO_LISTA = /^co(Floats|Ints|Bools|Percents|FloatsOrPercents|Points|Enums|Strings)$/;

const ENDERECO_HOST = /^print_host(_webui)?$|^printhost_(apikey|cafile|user|password|port)$/;

/**
 * Lista de textos gravada como um texto só, como o slicer lê (Config.cpp, unescape_strings_cstyle):
 * itens separados por ";", opcionalmente entre aspas, com escapes \n, \r e \x.
 */
function desserializarTextos(s) {
  const out = [];
  let i = 0;
  if (s === "") return out;
  for (;;) {
    while (s[i] === " " || s[i] === "\t") if (++i === s.length) return out;
    let item = "";
    if (s[i] === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) {
        let c = s[i];
        if (c === "\\") {
          if (++i === s.length) throw new Error(`texto mal formado: ${s.slice(0, 60)}`);
          c = s[i] === "n" ? "\n" : s[i] === "r" ? "\r" : s[i];
        }
        item += c;
      }
      if (i === s.length) throw new Error(`texto mal formado: ${s.slice(0, 60)}`);
      i++;
    } else {
      while (i < s.length && s[i] !== ";") item += s[i++];
    }
    out.push(item);
    while (s[i] === " " || s[i] === "\t") i++;
    if (i >= s.length) return out;
    if (s[i] !== ";") throw new Error(`texto mal formado: ${s.slice(0, 60)}`);
    i++;
  }
}

/** Tipos do slicer em processamento (só com --enums): normaliza listas gravadas como texto simples. */
let tiposAtuais = null;

/** Chaves dos perfis de filamento que o slicer de destino define como valor único (só com --enums). */
function escalaresFilamento(perfisFil) {
  if (!tiposAtuais) return {};
  const chaves = new Set();
  for (const p of Object.values(perfisFil)) {
    for (const k of Object.keys(p)) if (tiposAtuais[k] && !TIPO_LISTA.test(tiposAtuais[k])) chaves.add(k);
  }
  return chaves.size > 0 ? { escalaresFilamento: [...chaves].sort() } : {};
}

function achatar(perfil) {
  const out = {};
  for (const k of Object.keys(perfil).sort()) {
    if (CHAVES_META.has(k)) continue;
    let v = perfil[k];
    // Alguns perfis (ex.: Creality) gravam listas como texto: "0x0,153x0,..." ou "220". O slicer aceita
    // os dois formatos; no projeto ficam como lista, igual ao que o próprio slicer grava.
    const tipo = tiposAtuais?.[k];
    if (typeof v === "string" && tipo && TIPO_LISTA.test(tipo)) v = tipo === "coStrings" ? desserializarTextos(v) : v.split(",");
    // Endereço/credenciais de envio para a impressora: nunca vão para o projeto (alguns perfis da
    // Creality trazem o IP de rede interna de quem os criou).
    if (ENDERECO_HOST.test(k) && v !== "") v = "";
    if (typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"))) out[k] = v;
    else throw new Error(`valor inesperado em "${k}": ${JSON.stringify(v).slice(0, 80)}`);
  }
  return out;
}

function compativel(perfil, maquina) {
  const lista = perfil.compatible_printers ?? [];
  return Array.isArray(lista) && lista.includes(maquina);
}

function mesa(maq) {
  const pts = maq.printable_area.map((p) => p.split("x").map(Number));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    origemX: Math.min(...xs), origemY: Math.min(...ys),
    x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys),
    z: Number(maq.printable_height),
  };
}

/** Nome mostrado ao usuário: alguns modelos usam "_" no nome interno (ex.: "Creality K1C_CFS-C"). */
function nomeExibido(modelo) {
  return modelo.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function slug(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

function enumsDoOrca(raizOrca) {
  return enumsDoArquivo(join(raizOrca, "src", "libslic3r", "PrintConfig.cpp"));
}

function enumsDoArquivo(caminho) {
  const cpp = readFileSync(caminho, "utf8");
  const out = {};
  for (const bloco of cpp.split(/(?=this->add(?:_nullable)?\(\s*")/)) {
    const m = /^this->add(?:_nullable)?\(\s*"([^"]+)"\s*,\s*(co\w+)/.exec(bloco);
    if (!m || (m[2] !== "coEnum" && m[2] !== "coEnums")) continue;
    const valores = [...bloco.matchAll(/enum_values\.push_back\(\s*"([^"]*)"/g)].map((x) => x[1]);
    for (const lista of bloco.matchAll(/enum_values\s*=\s*\{([^}]*)\}/g)) {
      valores.push(...[...lista[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]));
    }
    if (valores.length > 0) out[m[1]] = [...new Set(valores)];
  }
  return out;
}

function textosDoBinario(caminho) {
  return new Set(readFileSync(caminho).toString("latin1").match(/[\x20-\x7e]{1,64}/g) ?? []);
}

/** Nota para escolher "o" perfil de um tipo: genérico primeiro, depois básico, sem variantes especiais. */
function nota(nome) {
  let n = 3;
  if (/^Generic /i.test(nome) || / Generic /i.test(nome)) n = 0;
  else if (/\bBasic\b/i.test(nome)) n = 1;
  else if (!ESPECIAL.test(nome)) n = 2;
  if (n === 0 && ESPECIAL.test(nome.replace(/^Generic /i, ""))) n = 2.5;
  return n;
}

/** Marca da fabricante em processamento (ex.: "Bambu"): no empate, o filamento da própria marca vence o de terceiros. */
let marcaAtual = "";

function melhor(nomes) {
  const deTerceiro = (n) => (marcaAtual && !n.toLowerCase().startsWith(marcaAtual.toLowerCase()) ? 1 : 0);
  return [...nomes].sort((a, b) => nota(a) - nota(b) || deTerceiro(a) - deTerceiro(b) || a.length - b.length || a.localeCompare(b))[0];
}

/** Regras de filamento automáticas a partir dos filamentos compatíveis com a máquina. */
function regrasAutomaticas(resolvidos, nomeMaquina) {
  const porTipo = new Map();
  for (const [nome, r] of resolvidos) {
    // A lista de compatíveis costuma vir herdada do perfil pai: só vale depois de resolver.
    if (!r || r.type !== "filament" || !compativel(r, nomeMaquina)) continue;
    const tipo = String((r.filament_type ?? [""])[0] ?? "").toUpperCase();
    if (!tipo) continue;
    if (!porTipo.has(tipo)) porTipo.set(tipo, []);
    porTipo.get(tipo).push(nome);
  }
  const plas = porTipo.get("PLA") ?? [];
  if (plas.length === 0) return null;
  const padrao = melhor(plas);
  const regras = [];
  const especial = (rotulo, tipos) => {
    const candidatos = tipos.flatMap((t) => porTipo.get(t) ?? []).filter((n) => new RegExp(`\\b${rotulo}\\b`, "i").test(n));
    if (candidatos.length) regras.push({ tipos: ["PLA", "SILK"], nomeContem: [rotulo.toLowerCase()], perfil: melhor(candidatos), exato: true });
  };
  especial("Silk", ["PLA", "SILK"]);
  especial("Matte", ["PLA"]);
  const agrupadas = new Map();
  for (const [origem, destinos] of Object.entries(TIPOS)) {
    const achado = destinos.find((t) => (porTipo.get(t) ?? []).length > 0);
    if (!achado) continue;
    const perfil = melhor(porTipo.get(achado));
    const exato = achado === origem || EXATOS.has(`${origem}>${achado}`);
    const chave = `${perfil}|${exato}`;
    if (!agrupadas.has(chave)) agrupadas.set(chave, { tipos: [], perfil, exato });
    agrupadas.get(chave).tipos.push(origem);
  }
  regras.push(...agrupadas.values());
  return { padrao, regras, tiposDisponiveis: [...porTipo.keys()].sort() };
}

// ---------------------------------------------------------------------------------------------

const raizes = argumentos();
const catalogo = lerJson(join(aqui, "perfis", "catalogo.json"));
const enumsOrca = capas ? enumsDoOrca(capas) : null;
mkdirSync(SAIDA, { recursive: true });
const hoje = new Date().toISOString().slice(0, 10);
const escritos = new Set();
const modelosIndice = new Map();
const pulados = [];

for (const [fork, fab] of Object.entries(catalogo.fabricantes)) {
  const raiz = raizes[fork];
  if (!raiz) throw new Error(`faltou --raiz ${fork}=<pasta resources/profiles>`);
  const idx = indexar(raiz, fab.pastas);
  marcaAtual = fab.fabricante.split(" ")[0];
  tiposAtuais = enumsProprios[fork] ? tiposDoArquivo(enumsProprios[fork]) : null;
  const pacote = lerJson(join(raiz, fab.pacotePerfis));
  const textos = enumsOrca && binarios[fork] ? textosDoBinario(binarios[fork]) : null;
  // Perfis instanciáveis já resolvidos (a compatibilidade costuma vir herdada do pai).
  const resolvidos = new Map();
  for (const [nome, j] of idx) if (j.instantiation === "true") resolvidos.set(nome, resolverSeguro(idx, nome));

  // Opções que o slicer de destino conhece (para o relatório não pedir revisão à toa):
  // do PrintConfig.cpp do próprio slicer (--enums), senão as do Orca que existem na biblioteca dele
  // (--binario); mais as chaves usadas nos perfis dele. Gravadas uma vez por slicer em opcoes-<fork>.json.
  let opcoes = null;
  if (tiposAtuais) opcoes = new Set(Object.keys(tiposAtuais));
  else if (capas && textos) {
    // Biblioteca do slicer: as opções do Orca presentes nela, mais QUALQUER identificador no formato de
    // opção (snake_case) que apareça nela. É de propósito largo: considerar conhecida uma opção que o
    // slicer não tem só mantém uma mudança inofensiva; o contrário descartaria uma mudança válida
    // (ex.: opções próprias da fabricante que não existem no Orca).
    opcoes = new Set(Object.keys(tiposDoArquivo(join(capas, "src", "libslic3r", "PrintConfig.cpp"))).filter((k) => textos.has(k)));
    for (const t of textos) if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(t)) opcoes.add(t);
  }
  if (opcoes) {
    for (const j of idx.values()) for (const k of Object.keys(j)) if (!CHAVES_META.has(k)) opcoes.add(k);
    writeFileSync(join(SAIDA, `opcoes-${fork}.json`), JSON.stringify({ formato: 1, slicer: fab.slicer.nome, opcoes: [...opcoes].sort() }) + "\n");
    escritos.add(`opcoes-${fork}.json`);
  }

  // Enums: do código do próprio slicer (--enums), senão do Orca filtrado pela biblioteca (--binario).
  const enumsFork = enumsProprios[fork] ? enumsDoArquivo(enumsProprios[fork]) : enumsOrca;
  let valoresAceitos;
  if (enumsFork) {
    valoresAceitos = {};
    for (const [chave, valores] of Object.entries(enumsFork)) {
      const aceitos = new Set(textos && !enumsProprios[fork] ? valores.filter((v) => textos.has(v)) : valores);
      for (const j of idx.values()) {
        const v = j[chave];
        if (typeof v === "string") aceitos.add(v);
        else if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && aceitos.add(x));
      }
      if (aceitos.size > 0) valoresAceitos[chave] = [...aceitos].sort();
    }
  }

  for (const { name: nomeMaquina } of pacote.machine_list) {
    const bruto = idx.get(nomeMaquina);
    if (!bruto) continue;
    const r = resolverSeguro(idx, nomeMaquina);
    if (!r || r.instantiation !== "true" || r.type !== "machine") continue;
    const modelo = r.printer_model;
    if (!modelo || catalogo.excluirModelos.includes(modelo)) continue;
    const maquina = achatar(r);
    const bico = Number(maquina.nozzle_diameter[0]);
    const hf = /\bHF\b/.test(nomeMaquina);
    const modeloId = slug(modelo);
    const id = `${modeloId}-${bico}${hf ? "hf" : ""}`;

    const processos = [];
    for (const [nome, p] of resolvidos) {
      if (!p || p.type !== "process" || !compativel(p, nomeMaquina)) continue;
      processos.push({ nome, alturaCamada: Number(p.layer_height), config: achatar(p) });
    }
    if (processos.length === 0) {
      pulados.push(`${nomeMaquina}: nenhum processo compatível`);
      continue;
    }
    processos.sort((a, b) => a.alturaCamada - b.alturaCamada || a.nome.localeCompare(b.nome));
    const porAltura = new Map();
    for (const p of processos) {
      const atual = porAltura.get(p.alturaCamada);
      if (!atual || (!atual.nome.includes(fab.processoPadraoContem) && p.nome.includes(fab.processoPadraoContem))) porAltura.set(p.alturaCamada, p);
    }
    for (const p of processos) p.padraoDaAltura = porAltura.get(p.alturaCamada) === p;

    const sobrescrita = catalogo.sobrescritas[id]?.filamentos;
    const auto = sobrescrita ? null : regrasAutomaticas(resolvidos, nomeMaquina);
    if (!sobrescrita && !auto) {
      pulados.push(`${nomeMaquina}: nenhum filamento PLA compatível`);
      continue;
    }
    const regrasFil = sobrescrita ?? { padrao: auto.padrao, regras: auto.regras };
    const perfisFil = {};
    for (const nome of [...new Set([regrasFil.padrao, ...regrasFil.regras.map((x) => x.perfil)])].sort()) {
      const f = resolver(idx, nome);
      if (f.type !== "filament") throw new Error(`${id}: "${nome}" não é filamento`);
      if (!compativel(f, nomeMaquina)) throw new Error(`${id}: "${nome}" não é compatível com ${nomeMaquina}`);
      perfisFil[nome] = achatar(f);
    }

    const extrusoras = maquina.nozzle_diameter.length;
    const tabela = catalogo.cores[modelo];
    const cores = tabela
      ? tabela
      : extrusoras > 1
        ? { max: extrusoras, multiMaterial: "trocaDeFerramenta", fonte: `${extrusoras} extrusoras no perfil` }
        : { max: 1, multiMaterial: "unicaCor", fonte: "uma extrusora, sem sistema multicor conhecido — a confirmar" };

    const saida = {
      formato: 1,
      id,
      modeloId,
      fabricante: fab.fabricante,
      impressora: nomeExibido(modelo),
      bico,
      variante: hf ? `${bico} HF` : String(bico),
      casamentoAutomatico: !hf,
      slicer: { ...fab.slicer, pacotePerfis: fab.pacotePerfis, versaoPacotePerfis: pacote.version, ...(opcoes ? { opcoes: fork } : {}) },
      geradoEm: hoje,
      mesa: mesa(maquina),
      maxFilamentos: cores.max,
      fonteMaxFilamentos: cores.fonte,
      extrusoras,
      multiMaterial: cores.multiMaterial,
      tipoMesa: fab.tipoMesa,
      regrasFilamento: sobrescrita ? "manuais (conferidas no slicer)" : "automáticas",
      maquina: { nome: nomeMaquina, config: maquina },
      processos,
      filamentos: { padrao: regrasFil.padrao, regras: regrasFil.regras, perfis: perfisFil },
      ...(valoresAceitos ? { valoresAceitos } : {}),
      ...escalaresFilamento(perfisFil),
    };
    writeFileSync(join(SAIDA, `${id}.json`), JSON.stringify(saida, null, 1) + "\n");
    escritos.add(`${id}.json`);

    if (!modelosIndice.has(modeloId)) {
      modelosIndice.set(modeloId, {
        id: modeloId,
        fabricante: fab.fabricante,
        impressora: nomeExibido(modelo),
        slicer: fab.slicer.nome,
        maxFilamentos: cores.max,
        fonteMaxFilamentos: cores.fonte,
        capa: `${modeloId}.png`,
        perfis: [],
        _fork: fork,
        _raiz: raiz,
        _pastaCapa: fab.pastas[0],
        _modelo: modelo,
      });
    }
    modelosIndice.get(modeloId).perfis.push({ id, bico, variante: saida.variante, casamentoAutomatico: !hf, regrasFilamento: saida.regrasFilamento });
  }
}

// Remove perfis antigos que não foram gerados nesta rodada.
for (const nome of readdirSync(SAIDA)) {
  if (nome.endsWith(".json") && nome !== "indice.json" && !escritos.has(nome)) unlinkSync(join(SAIDA, nome));
}

// Capas por modelo: repositório oficial do OrcaSlicer; senão, a do slicer da fabricante.
const origensCapas = [];
let commit = "desconhecido";
if (capas) {
  mkdirSync(SAIDA_CAPAS, { recursive: true });
  try {
    commit = execFileSync("git", ["-C", capas, "log", "-1", "--format=%H %cs"], { encoding: "utf8" }).trim();
  } catch {
    /* não é um clone git */
  }
  for (const nome of readdirSync(SAIDA_CAPAS)) if (nome.endsWith(".png")) unlinkSync(join(SAIDA_CAPAS, nome));
  for (const m of modelosIndice.values()) {
    const doOrca = join(capas, "resources", "profiles", m._pastaCapa, `${m._modelo}_cover.png`);
    const doSlicer = join(m._raiz, m._pastaCapa, `${m._modelo}_cover.png`);
    const origem = existsSync(doOrca) ? doOrca : existsSync(doSlicer) ? doSlicer : null;
    if (!origem) {
      m.capa = null;
      origensCapas.push(`- ${m.id}: sem imagem`);
      continue;
    }
    copyFileSync(origem, join(SAIDA_CAPAS, m.capa));
    const fonteSlicer = enumsProprios[m._fork] ? `repositório oficial do ${m.slicer}` : `slicer da fabricante (${m.slicer})`;
    origensCapas.push(`- ${m.capa}: ${origem === doOrca ? "repositório OrcaSlicer" : fonteSlicer}, ${m._modelo}_cover.png`);
  }
  writeFileSync(
    join(SAIDA_CAPAS, "ORIGEM.md"),
    [
      "# Imagens das impressoras",
      "",
      "Copiadas por conversao/scripts/gerar-perfis.mjs (--capas). Primeiro do repositório oficial do OrcaSlicer;",
      "quando o modelo não existe lá, da instalação do slicer da fabricante.",
      "",
      "- Repositório: https://github.com/OrcaSlicer/OrcaSlicer",
      `- Commit: ${commit}`,
      "- Licença do repositório: GNU AGPL-3.0 (ver LICENSE.txt do repositório). As imagens provavelmente são das fabricantes.",
      "",
      ...origensCapas.sort(),
      "",
    ].join("\n"),
  );
}

const modelos = [...modelosIndice.values()]
  .map(({ _fork, _raiz, _pastaCapa, _modelo, ...m }) => {
    void _fork; void _raiz; void _pastaCapa; void _modelo;
    return { ...m, perfis: m.perfis.sort((a, b) => a.bico - b.bico || a.variante.localeCompare(b.variante)) };
  })
  .sort((a, b) => a.fabricante.localeCompare(b.fabricante) || a.impressora.localeCompare(b.impressora, "pt-BR", { numeric: true }));
writeFileSync(join(SAIDA, "indice.json"), JSON.stringify({ formato: 1, geradoEm: hoje, modelos }, null, 1) + "\n");

for (const m of modelos) {
  console.log(`${m.impressora.padEnd(32)} cores=${String(m.maxFilamentos).padEnd(2)} bicos=${m.perfis.map((p) => p.variante + (p.regrasFilamento.startsWith("manuais") ? "*" : "")).join(",")} | ${m.fonteMaxFilamentos}`);
}
console.log(`${escritos.size} perfis, ${modelos.length} modelos. * = regras de filamento manuais.`);
if (pulados.length) console.log(`Pulados:\n  ${pulados.join("\n  ")}`);
