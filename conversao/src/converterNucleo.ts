// Núcleo da conversão de um .3mf para uma impressora de destino, sem disco nem Firebase:
// ZIP já aberto -> fluxo de saída + relatório. É o mesmo código no servidor (converter.ts, que lê e
// grava arquivos) e no navegador (versão estática, que lê o arquivo escolhido e monta o download).
// Nada do arquivo é executado; geometria, pintura, modificadores e miniaturas são copiados.
import { PassThrough, Transform, type Writable } from "node:stream";
import yazl from "yazl";
import { bicoDaOrigem, converterConfiguracao, lerConfigOrigem } from "./configProjeto.js";
import { ErroConversao } from "./erros.js";
import type { LimitesConversao } from "./limites.js";
import { analisarModelSettings, reescreverModelSettings, type InfoModelSettings } from "./modelSettings.js";
import {
  AcumuladorGeometria,
  CAMINHO_MODELO,
  criarReescritorModelo,
  leitorEstrutura,
  origemPlaca,
  resolverReferencias,
  type Caixa,
} from "./modeloPrincipal.js";
import { familiaConvertivel, identificarOrigem, lerMetadadosCabecalho, mensagemOrigemNaoSuportada } from "./origem.js";
import { obterModelo, obterPerfil, perfilParaBico, type PerfilAlvo } from "./perfis.js";
import { Relatorio, type RelatorioConversao } from "./relatorio.js";
import { eEntradaGcode } from "./resumoProjeto.js";
import { analisarXmlFluxo, analisarXmlTexto } from "./xmlSeguro.js";
import type { ZipSeguro, EntradaZip } from "./zipSeguro.js";

export interface DestinoConversao {
  /** Impressora de destino (modelo). O bico é escolhido pelo diâmetro do projeto. */
  modeloId?: string;
  /** Alternativa: perfil exato (modelo + bico). Usado em testes e ferramentas. */
  perfilId?: string;
}

/** Escolhe o perfil de destino quando o bico do projeto já é conhecido. */
export type ResolverPerfil = (bico: number | null) => PerfilAlvo;

export interface ResultadoConversao {
  relatorio: RelatorioConversao;
  bytesSaida: number;
}

const CAMINHO_PROJETO = "Metadata/project_settings.config";
const CAMINHO_SETTINGS = "Metadata/model_settings.config";

/** Entradas exclusivas do Bambu Studio que não vão para o arquivo convertido. */
const REMOVER: Array<{ re: RegExp; descricao: string }> = [
  { re: /^Metadata\/slice_info\.config$/i, descricao: "Informações de fatiamento do Bambu Studio (slice_info)." },
  { re: /^Metadata\/filament_sequence\.json$/i, descricao: "Sequência de filamentos do AMS." },
  { re: /^Metadata\/(process|filament|machine)_settings_\d+\.config$/i, descricao: "Presets de usuário do slicer de origem embutidos no projeto." },
  { re: /^Metadata\/creality\.config$/i, descricao: "Dados exclusivos do Creality Print." },
];

const XML_PEQUENO = /(\.rels|\.xml)$/i;

function eProibidoGcode(e: EntradaZip): boolean {
  return eEntradaGcode(e.nome);
}

/** Valida o destino antes de abrir o arquivo (recusa modelo desconhecido). */
export function resolverDestino(destino: DestinoConversao): ResolverPerfil {
  if (destino.perfilId) {
    const fixo = obterPerfil(destino.perfilId);
    return () => fixo;
  }
  if (destino.modeloId) {
    obterModelo(destino.modeloId);
    const modeloId = destino.modeloId;
    return (bico) => perfilParaBico(modeloId, bico);
  }
  throw new ErroConversao("PERFIL_DESCONHECIDO");
}

/**
 * Converte um ZIP já aberto, gravando o novo .3mf em `saida`. Só resolve depois que `saida` terminou
 * de receber tudo ("finish"). Em erro, `saida` é destruída. Erros inesperados viram ESTRUTURA_INESPERADA.
 * `saida` pode ser uma função: só é chamada depois de todas as validações, quando a escrita começa
 * (no servidor, o arquivo de saída nem é criado se o projeto for recusado antes).
 */
export async function converterZip(
  zip: ZipSeguro,
  destino: DestinoConversao | ResolverPerfil,
  limites: LimitesConversao,
  saida: Writable | (() => Writable),
): Promise<ResultadoConversao> {
  const resolverPerfil = typeof destino === "function" ? destino : resolverDestino(destino);
  try {
    return await converterAberto(zip, resolverPerfil, limites, saida);
  } catch (e) {
    throw e instanceof ErroConversao ? e : new ErroConversao("ESTRUTURA_INESPERADA", undefined, { cause: e });
  }
}

async function converterAberto(
  zip: ZipSeguro,
  resolverPerfil: ResolverPerfil,
  limites: LimitesConversao,
  saida: Writable | (() => Writable),
): Promise<ResultadoConversao> {
  const rel = new Relatorio();

  // 1. Estrutura mínima e recusa de arquivos fatiados ------------------------------------------
  const eProjeto = zip.obter(CAMINHO_PROJETO);
  const eModelo = zip.obter(CAMINHO_MODELO);
  if (!eModelo) throw new ErroConversao("NAO_E_PROJETO");
  if (zip.entradas.some(eProibidoGcode)) throw new ErroConversao("PROJETO_COM_GCODE");

  // Slicer de origem: os arquivos vêm dos usuários, de qualquer slicer. O cabeçalho é lido só
  // por regex aqui; o arquivo inteiro passa pelo parser XML seguro logo adiante.
  const cabecalho = lerMetadadosCabecalho(await zip.lerInicio(eModelo, 64 * 1024));
  const origemSlicer = identificarOrigem(zip.entradas.map((e) => e.nome), cabecalho, eProjeto !== undefined);
  if (!origemSlicer.suportado || !eProjeto) {
    const familiaSuportada = familiaConvertivel(origemSlicer.slicer);
    if (familiaSuportada && !eProjeto) throw new ErroConversao("NAO_E_PROJETO");
    throw new ErroConversao("ORIGEM_NAO_SUPORTADA", mensagemOrigemNaoSuportada(origemSlicer));
  }

  // 2. XMLs pequenos (rels, content types, metadados XML): validados para recusar DTD/XXE --------
  for (const e of zip.entradas) {
    if (e.diretorio || !XML_PEQUENO.test(e.nome)) continue;
    if (REMOVER.some((r) => r.re.test(e.nome))) continue;
    analisarXmlTexto(await zip.lerTexto(e, limites.maxBytesConfiguracao), {}, limites.maxProfundidadeXml);
  }

  // 3. Configuração do projeto -----------------------------------------------------------------
  const origem = lerConfigOrigem(await zip.lerTexto(eProjeto, limites.maxBytesConfiguracao), limites);
  // O perfil de destino depende do bico do projeto (o usuário escolhe só o modelo).
  const perfil = resolverPerfil(bicoDaOrigem(origem));
  const rc = converterConfiguracao(origem, perfil, limites, rel);
  if (rc.origem.impressora === perfil.maquina.nome) {
    rel.aviso("MESMA_IMPRESSORA", `O projeto já era para ${perfil.impressora}; os perfis foram reaplicados a partir do ${perfil.slicer.nome}.`);
  }

  // 4. model_settings -----------------------------------------------------------------------------
  const eSettings = zip.obter(CAMINHO_SETTINGS);
  let textoSettings: string | null = null;
  let info: InfoModelSettings | null = null;
  if (eSettings) {
    textoSettings = await zip.lerTexto(eSettings, limites.maxBytesConfiguracao);
    info = analisarModelSettings(textoSettings, limites.maxProfundidadeXml);
    // Placa que aponta para G-code presente no pacote = arquivo fatiado. Referência sem o arquivo
    // (sobra de um fatiamento não salvo) é só limpa.
    const normalizar = (c: string) => c.replace(/^\/+/, "").toLowerCase();
    const nomes = new Set(zip.entradas.map((e) => e.nome.toLowerCase()));
    if (info.referenciasGcode.some((g) => nomes.has(normalizar(g)))) throw new ErroConversao("PROJETO_COM_GCODE");
    if (info.referenciasGcode.length > 0) {
      rel.descartados.push({ categoria: "pacote", descricao: "Referência a G-code de um fatiamento anterior (arquivo ausente no projeto) removida das placas." });
    }
    if (info.maiorExtrusor > rc.nFilamentos) {
      rel.aviso("EXTRUSOR_INVALIDO", `Há objetos atribuídos ao filamento ${info.maiorExtrusor}, mas o projeto tem ${rc.nFilamentos}. Reatribua no slicer.`);
    }
    for (const k of new Set(info.metadadosBloqueados)) {
      rel.descartados.push({ categoria: "configuracao", chave: k, descricao: "Configuração por objeto removida por segurança (G-code ou script)." });
    }
  }

  // 5. Estrutura do modelo e deslocamento das placas -------------------------------------------
  // O modelo principal pode ter centenas de MB de malha embutida: lido em streaming, duas vezes
  // (estrutura agora; vértices e ajuste de posição durante a cópia).
  const leitor = leitorEstrutura();
  await analisarXmlFluxo(await zip.abrirFluxo(eModelo), leitor.manipuladores, limites.maxProfundidadeXml, { namespaces: false });
  const est = leitor.resultado();
  const { refs, incompletos } = resolverReferencias(est);

  const placaDoItem: Array<number | null> = est.itens.map(() => null);
  const nPlacas = Math.max(1, info?.placas.length ?? 1);
  if (info && info.placas.length > 0) {
    const posPorObjeto = new Map<string, number[]>();
    est.itens.forEach((it, i) => {
      const l = posPorObjeto.get(it.objeto) ?? [];
      l.push(i);
      posPorObjeto.set(it.objeto, l);
    });
    info.placas.forEach((p, indicePlaca) => {
      for (const inst of p.instancias) {
        const itensDoObjeto = posPorObjeto.get(inst.objeto) ?? [];
        // Instância k do objeto = k-ésimo item com esse objectid (se houver só um, é ele).
        const item = itensDoObjeto.length === 1 ? itensDoObjeto[0] : itensDoObjeto[inst.instancia];
        if (item !== undefined) placaDoItem[item] = indicePlaca;
      }
    });
  } else {
    placaDoItem.fill(0);
  }
  if (placaDoItem.some((p) => p === null)) {
    rel.aviso("OBJETO_SEM_PLACA", "Há objetos que não pertencem a nenhuma placa; as posições deles não foram ajustadas.");
  }

  const mo = rc.origem.mesa;
  const md = perfil.mesa;
  const mesmaMesa = Math.abs(mo.x - md.x) < 1e-6 && Math.abs(mo.y - md.y) < 1e-6 && mo.origemX === md.origemX && mo.origemY === md.origemY;
  const deltas: Array<[number, number]> = placaDoItem.map((p) => {
    if (p === null || mesmaMesa) return [0, 0];
    const [ox, oy] = origemPlaca(p, nPlacas, mo.x, mo.y);
    const [nx, ny] = origemPlaca(p, nPlacas, md.x, md.y);
    return [nx + md.origemX - (ox + mo.origemX), ny + md.origemY - (oy + mo.origemY)];
  });
  const ajustarPosicoes = !mesmaMesa && deltas.some(([dx, dy]) => dx !== 0 || dy !== 0);
  const geo = new AcumuladorGeometria(est.itens.length, refs);

  // Cabeçalho "Application": slicers da família Bambu só carregam as configurações de projetos com
  // "BambuStudio-<versão>" e tratam versões antigas como legadas. O Creality Print só trata como seu
  // (sem pedir para escolher a impressora e refazer as configurações) projeto cujo cabeçalho cite
  // "Creality" ou que tenha Metadata/creality.config. Bambu Studio e Creality Print recebem sempre a
  // própria versão; os demais, só quando a origem não é da família (ex.: Creality Print).
  const appOrigem = cabecalho.get("Application") ?? "";
  const appDestino = perfil.slicer.aplicacao;
  const aplicacao =
    appDestino && appDestino !== appOrigem && (perfil.slicer.reescreverAplicacao === "sempre" || !appOrigem.startsWith("BambuStudio-"))
      ? appDestino
      : null;
  if (aplicacao) {
    rel.substituidos.push({
      categoria: "pacote",
      descricao: `Projeto marcado como salvo pelo ${perfil.slicer.nome}, para o slicer reconhecer o projeto e carregar as configurações.`,
      de: appOrigem || "(não informado)",
      para: aplicacao,
    });
  }

  // 7. Escreve a saída (copiando a geometria e analisando as malhas no caminho) -----------------
  const textoSaidaProjeto = JSON.stringify(rc.config, null, 4) + "\n";
  const settingsAjustado = textoSettings !== null ? reescreverModelSettings(textoSettings, rc.nFilamentos, perfil) : null;
  const textoSaidaSettings = settingsAjustado?.texto ?? null;
  for (const aj of settingsAjustado?.ajustes ?? []) {
    if (aj.para === null) {
      rel.revisar.push({
        categoria: "processo",
        chave: aj.chave,
        descricao: "Configuração de um objeto com valor que não existe no destino; o objeto passa a usar a configuração global.",
        de: aj.de,
      });
    } else {
      rel.mantidos.push({ categoria: "processo", chave: aj.chave, descricao: "Configuração de um objeto mantida com o nome que o destino usa.", de: aj.de, para: aj.para });
    }
  }
  const substituir = new Map<string, string>([[CAMINHO_PROJETO, textoSaidaProjeto]]);
  if (textoSaidaSettings !== null) substituir.set(CAMINHO_SETTINGS, textoSaidaSettings);

  const removidos = new Map<string, number>();
  let temGcodePorCamada = false;
  const zipSaida = new yazl.ZipFile();
  let bytesSaida = 0;
  const contador = new Transform({
    transform(trecho: Buffer, _enc, cb) {
      bytesSaida += trecho.length;
      cb(null, trecho);
    },
  });
  const destino = typeof saida === "function" ? saida() : saida;
  const fim = new Promise<void>((resolve, reject) => {
    zipSaida.outputStream.on("error", reject);
    destino.on("error", reject);
    destino.on("finish", () => resolve());
    // Destruída no caminho de erro: "close" sem "finish" (sem isso, a espera abaixo nunca termina).
    destino.on("close", () => resolve());
  });
  zipSaida.outputStream.pipe(contador).pipe(destino);

  try {
    for (const e of zip.entradas) {
      if (e.diretorio) continue;
      const remover = REMOVER.find((r) => r.re.test(e.nome));
      if (remover) {
        removidos.set(remover.descricao, (removidos.get(remover.descricao) ?? 0) + 1);
        continue;
      }
      if (/^Metadata\/custom_gcode_per_layer\.xml$/i.test(e.nome)) temGcodePorCamada = true;
      const opcoesEntrada = { mtime: e.data, compressionLevel: limites.nivelCompressao };
      const texto = substituir.get(e.nome);
      if (texto !== undefined) {
        zipSaida.addBuffer(Buffer.from(texto, "utf8"), e.nome, opcoesEntrada);
        continue;
      }
      const fluxo = await zip.abrirFluxo(e);
      const paraZip = new PassThrough();
      zipSaida.addReadStream(paraZip, e.nome, opcoesEntrada);
      const etapas: Array<Promise<void>> = [
        new Promise((resolve, reject) => {
          paraZip.on("end", () => resolve());
          paraZip.on("error", reject);
        }),
      ];
      // O modelo principal já foi validado na leitura da estrutura; só é lido de novo se tiver malha.
      if (/\.model$/i.test(e.nome) && (e.nome !== CAMINHO_MODELO || refs.has(CAMINHO_MODELO))) {
        // Malhas: XML validado e vértices medidos (coordenadas de origem) no caminho da cópia.
        const paraXml = new PassThrough();
        fluxo.pipe(paraXml);
        etapas.push(analisarXmlFluxo(paraXml, geo.manipuladores(e.nome), limites.maxProfundidadeXml, { namespaces: false }));
      }
      fluxo.on("error", (err) => paraZip.destroy(err));
      if (e.nome === CAMINHO_MODELO && (ajustarPosicoes || aplicacao)) {
        const deslocador = criarReescritorModelo({ deltas: ajustarPosicoes ? deltas : null, aplicacao });
        deslocador.on("error", (err) => paraZip.destroy(err));
        fluxo.pipe(deslocador).pipe(paraZip);
      } else {
        fluxo.pipe(paraZip);
      }
      await Promise.all(etapas);
    }
    zipSaida.end();
    await fim;
  } catch (e) {
    zipSaida.outputStream.unpipe(contador);
    contador.unpipe(destino);
    destino.destroy();
    await fim.catch(() => undefined);
    throw e;
  }

  // 8. Relatório -------------------------------------------------------------------------------
  for (const [descricao, qtd] of removidos) {
    rel.descartados.push({ categoria: "pacote", descricao: qtd > 1 ? `${descricao} (${qtd} arquivos)` : descricao });
  }
  if (temGcodePorCamada) {
    rel.aviso("GCODE_POR_CAMADA", "O projeto tem comandos por camada (pausas, trocas de cor ou G-code personalizado) feitos para o Bambu. Revise-os no slicer de destino.");
    rel.revisar.push({ categoria: "configuracao", descricao: "Comandos personalizados por camada (custom_gcode_per_layer)." });
  }
  verificarMesa(geo.caixas, placaDoItem, incompletos, deltas, perfil, nPlacas, rel);

  rel.mantidos.unshift(
    { categoria: "geometria", descricao: `Geometria, pintura multicor, peças e modificadores copiados sem alteração (${est.itens.length} itens de montagem).` },
    {
      categoria: "geometria",
      descricao: !ajustarPosicoes
        ? "Posição dos objetos mantida (mesa de mesmo tamanho)."
        : `Posição de cada objeto mantida em relação à sua placa (${nPlacas} placa(s)); a grade de placas foi ajustada à mesa de ${md.x} × ${md.y} mm.`,
    },
    { categoria: "filamento", descricao: `Cores e ordem dos ${rc.nFilamentos} filamento(s) mantidas.` },
  );

  const relatorio: RelatorioConversao = {
    versaoFormato: 1,
    destino: {
      perfilId: perfil.id,
      impressora: perfil.impressora,
      bico: perfil.bico,
      slicer: perfil.slicer.nome,
      versaoPacotePerfis: perfil.slicer.versaoPacotePerfis,
    },
    origem: {
      slicer: origemSlicer.slicer,
      versaoSlicer: origemSlicer.versao,
      impressora: rc.origem.impressora,
      versaoProjeto: rc.origem.versaoProjeto,
      alturaCamada: rc.origem.alturaCamada,
      filamentos: rc.nFilamentos,
      placas: info?.placas.length ?? 0,
      objetos: info?.objetos ?? est.objetos.size,
    },
    processo: rc.processo,
    filamentos: rc.filamentos,
    mantidos: rel.mantidos,
    substituidos: rel.substituidos,
    revisar: rel.revisar,
    descartados: rel.descartados,
    avisos: rel.avisos,
    resumo: {
      mantidos: rel.mantidos.length,
      substituidos: rel.substituidos.length,
      revisar: rel.revisar.length,
      descartados: rel.descartados.length,
      avisos: rel.avisos.length,
      situacao: rel.revisar.length > 0 || rel.avisos.length > 0 ? "revisar" : "ok",
    },
  };
  return { relatorio, bytesSaida };
}

const TOL = 0.05;

function verificarMesa(
  caixas: Array<Caixa | null>,
  placaDoItem: Array<number | null>,
  incompletos: Set<number>,
  deltas: Array<[number, number]>,
  perfil: PerfilAlvo,
  nPlacas: number,
  rel: Relatorio,
): void {
  const md = perfil.mesa;
  const naoCabe = new Map<number, string>();
  const fora = new Set<number>();
  let semGeometria = incompletos.size > 0;
  caixas.forEach((c, i) => {
    if (!c) {
      semGeometria = true;
      return;
    }
    const placa = placaDoItem[i];
    const dx = c.max[0] - c.min[0];
    const dy = c.max[1] - c.min[1];
    const dz = c.max[2] - Math.min(0, c.min[2]);
    const rotulo = placa === null ? 0 : placa + 1;
    if (dx > md.x + TOL || dy > md.y + TOL || dz > md.z + TOL) {
      if (!naoCabe.has(rotulo)) naoCabe.set(rotulo, `${dx.toFixed(1)} × ${dy.toFixed(1)} × ${dz.toFixed(1)} mm`);
      return;
    }
    if (placa === null) return;
    const [ox, oy] = origemPlaca(placa, nPlacas, md.x, md.y);
    const d = deltas[i] ?? [0, 0];
    // Caixa já na posição de destino.
    const minX = c.min[0] + d[0] - (ox + md.origemX);
    const maxX = c.max[0] + d[0] - (ox + md.origemX);
    const minY = c.min[1] + d[1] - (oy + md.origemY);
    const maxY = c.max[1] + d[1] - (oy + md.origemY);
    if (minX < -TOL || minY < -TOL || maxX > md.x + TOL || maxY > md.y + TOL) fora.add(rotulo);
  });
  for (const [placa, medida] of naoCabe) {
    rel.aviso(
      "NAO_CABE_NA_MESA",
      `${placa ? `Placa ${placa}` : "Um objeto fora das placas"}: há objeto de ${medida}, maior que a área de impressão de ${md.x} × ${md.y} × ${md.z} mm do ${perfil.impressora}. Reduza a escala ou divida o objeto.`,
    );
  }
  for (const placa of [...fora].sort((a, b) => a - b)) {
    rel.aviso(
      "FORA_DA_AREA",
      `Placa ${placa}: há objetos que ficam fora da área de impressão de ${md.x} × ${md.y} mm. Reposicione ou use "Arrumar" no slicer.`,
    );
  }
  if (semGeometria) {
    rel.aviso("GEOMETRIA_NAO_VERIFICADA", "Não foi possível medir todos os objetos; confira no slicer se cabem na mesa.");
  }
}
