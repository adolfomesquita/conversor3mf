// Configuração do site (GitHub Pages). Não há servidor nem área admin: mude aqui e publique.
import type { Doacao } from "./servicos/formatos";

export const NOME_APP = "Conversor 3MF";

export const CONFIGURACAO: {
  /** Limite do arquivo (o navegador precisa de memória para a entrada e a saída). */
  tamanhoMaximoMb: number;
  /**
   * Quadro "Apoie o projeto" ao fim da conversão. null = escondido.
   * Exemplo: { pix: { chave: "sua-chave-pix", nome: "NOME DO RECEBEDOR", cidade: "CIDADE" }, link: "https://..." }
   * (nome até 25 e cidade até 15 caracteres, sem acento, como no Pix).
   */
  doacao: Doacao | null;
  /** Endereço do código-fonte (exigido pela licença AGPL dos perfis). null = sem link. */
  codigoFonte: string | null;
  /** E-mail público para reportar problemas (link no rodapé, na privacidade e nos erros). null = sem link. */
  contato: string | null;
  /**
   * Endereço de contagem do GoatCounter (visitas e conversões, sem cookies). null = nada é contado.
   * Só conta no site publicado (https), nunca em desenvolvimento nem em endereço local.
   */
  estatistica: string | null;
} = {
  tamanhoMaximoMb: 300,
  doacao: null,
  codigoFonte: "https://github.com/adolfomesquita/conversor3mf",
  contato: "conversor3mf@gmail.com",
  estatistica: "https://conversor3mf.goatcounter.com/count",
};

/** Link "mailto:" que abre o programa de e-mail da pessoa; nada é enviado sem ela mandar. */
export function linkContato(assunto: string, corpo?: string): string | null {
  if (!CONFIGURACAO.contato) return null;
  const partes = [`subject=${encodeURIComponent(assunto)}`];
  if (corpo) partes.push(`body=${encodeURIComponent(corpo)}`);
  return `mailto:${CONFIGURACAO.contato}?${partes.join("&")}`;
}
