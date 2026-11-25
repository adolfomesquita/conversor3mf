// Nome do arquivo baixado: "<nome original>_<impressora de destino>.3mf".

const MAX_CARACTERES = 100;

/** Tira caracteres que o Windows, o macOS ou o Linux não aceitam em nome de arquivo. */
function limpar(texto: string): string {
  const semInvalidos = Array.from(texto, (c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? "_" : c)).join("");
  return semInvalidos.replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
}

/** "dragon.3mf" + "Bambu Lab P1S" → "dragon_Bambu Lab P1S.3mf". Sem nome original → "convertido_Bambu Lab P1S.3mf". */
export function nomeDoResultado(original: string | null, impressora: string): string {
  const base = limpar((original ?? "").replace(/\.3mf$/i, "")).slice(0, MAX_CARACTERES).trim() || "convertido";
  const sufixo = limpar(impressora) || "convertido";
  const nome = base.toLowerCase().endsWith(`_${sufixo.toLowerCase()}`) ? base : `${base}_${sufixo}`;
  return `${nome}.3mf`;
}
