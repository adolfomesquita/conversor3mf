// Mensagens entre a página e o Worker da conversão.
import type { CodigoErroConversao } from "@conversao/erros";
import type { RelatorioConversao } from "@conversao/relatorio";

export interface PedidoConversao {
  arquivo: File;
  modeloId: string;
}

export type ResultadoConversao =
  | { tipo: "ok"; arquivo: Blob; relatorio: RelatorioConversao; milissegundos: number }
  | { tipo: "erro"; codigo: CodigoErroConversao; mensagem: string };

export type MensagemWorker = ResultadoConversao | { tipo: "progresso"; fracao: number };

export interface ConversaoEmAndamento {
  resultado: Promise<ResultadoConversao>;
  cancelar: () => void;
}

/** Converte num Worker novo (encerrado no fim, para devolver a memória). */
export function converterNoNavegador(pedido: PedidoConversao, aoProgresso?: (fracao: number) => void): ConversaoEmAndamento {
  const worker = new Worker(new URL("./conversor.worker.ts", import.meta.url), { type: "module" });
  let encerrar: (r: ResultadoConversao) => void = () => undefined;
  const resultado = new Promise<ResultadoConversao>((resolve) => {
    encerrar = (r) => {
      worker.terminate();
      resolve(r);
    };
  });
  worker.onmessage = (ev: MessageEvent<MensagemWorker>) => {
    if (ev.data.tipo === "progresso") aoProgresso?.(ev.data.fracao);
    else encerrar(ev.data);
  };
  worker.onerror = (ev) => {
    console.error(ev.message);
    encerrar({ tipo: "erro", codigo: "ESTRUTURA_INESPERADA", mensagem: "Não foi possível converter neste navegador. Tente um navegador atualizado (Chrome, Edge, Firefox ou Safari)." });
  };
  worker.postMessage(pedido);
  return {
    resultado,
    cancelar: () => encerrar({ tipo: "erro", codigo: "ESTRUTURA_INESPERADA", mensagem: "Conversão cancelada." }),
  };
}
