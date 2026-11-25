import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { converterNoNavegador } from "./mensagensWorker";
import "./estilos.css";

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Só no desenvolvimento: ponto de teste para comparar com a conversão no Node (scripts/referencia-navegador.mjs).
if (import.meta.env.DEV) {
  Object.assign(window, {
    __converterUrl: async (url: string, modeloId: string) => {
      const dados = await (await fetch(url)).blob();
      const arquivo = new File([dados], "amostra.3mf");
      const r = await converterNoNavegador({ arquivo, modeloId }).resultado;
      if (r.tipo === "erro") return r;
      const { unzipSync } = await import("fflate");
      const entradas = unzipSync(new Uint8Array(await r.arquivo.arrayBuffer()));
      const hashes: Record<string, string> = {};
      for (const [nome, conteudo] of Object.entries(entradas)) {
        const h = new Uint8Array(await crypto.subtle.digest("SHA-256", conteudo as Uint8Array<ArrayBuffer>));
        hashes[nome] = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      return { tipo: "ok", milissegundos: r.milissegundos, bytes: r.arquivo.size, nomes: Object.keys(entradas), hashes, relatorio: r.relatorio };
    },
    // Compara com a referência do Node (mesma pasta): nomes, conteúdo de cada entrada e relatório.
    __rodar: async (base: string, casos: Array<[string, string]>) => {
      const w = window as unknown as Record<string, unknown> & { __converterUrl: (u: string, m: string) => Promise<Record<string, unknown>> };
      const ref = (await (await fetch(base + "referencia.json")).json()) as Record<string, Record<string, unknown>>;
      const res: Record<string, unknown> = {};
      w.__res = res;
      for (const [arq, modeloId] of casos) {
        const r = (await w.__converterUrl(base + arq, modeloId)) as { tipo: string; nomes: string[]; hashes: Record<string, string>; relatorio: unknown; milissegundos: number; bytes: number; mensagem?: string };
        const e = ref[arq] as { tipo: string; nomes: string[]; hashes: Record<string, string>; relatorio: unknown; ms: number };
        if (r.tipo !== e.tipo) {
          res[arq] = { igual: false, motivo: r.mensagem };
          continue;
        }
        const difHash = e.nomes.filter((n) => r.hashes[n] !== e.hashes[n]);
        const nomesIguais = JSON.stringify(r.nomes) === JSON.stringify(e.nomes);
        const relIgual = JSON.stringify(r.relatorio) === JSON.stringify(e.relatorio);
        res[arq] = { igual: nomesIguais && relIgual && difHash.length === 0, nomesIguais, relIgual, difHash: difHash.slice(0, 5), msNavegador: r.milissegundos, msServidor: e.ms, bytes: r.bytes };
      }
      return res;
    },
  });
}
