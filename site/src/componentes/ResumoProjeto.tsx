import { useCallback, useEffect, useState } from "react";
import { capaDaImpressora, type ResumoProjeto as Resumo } from "../servicos/analiseProjeto";
import { formatarBico } from "../servicos/formatos";

/** Cor do número sobre a amostra ("#RRGGBB" já validado): preto em cores claras, branco nas escuras. */
function corDoTexto(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#111" : "#fff";
}

function formatarMm(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** Resumo do projeto lido no navegador, antes de converter. */
export function ResumoProjeto({ resumo, nomeArquivo }: { resumo: Resumo; nomeArquivo: string }) {
  const [capa, setCapa] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    capaDaImpressora(resumo.impressora).then((c) => {
      if (ativo) setCapa(c);
    });
    return () => {
      ativo = false;
    };
  }, [resumo.impressora]);

  // Miniatura (PNG do próprio arquivo): URL de blob criada e revogada junto com o <img>.
  const blob = resumo.miniatura;
  const refMiniatura = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !blob) return;
      const url = URL.createObjectURL(blob);
      img.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [blob],
  );

  const detalhes = [
    resumo.bico !== null ? `bico ${formatarBico(resumo.bico)} mm` : null,
    resumo.alturaCamada !== null ? `camada ${formatarMm(resumo.alturaCamada)} mm` : null,
    resumo.placas ? `${resumo.placas} ${resumo.placas === 1 ? "placa" : "placas"}` : null,
    resumo.objetos ? `${resumo.objetos} ${resumo.objetos === 1 ? "objeto" : "objetos"}` : null,
  ].filter(Boolean);

  return (
    <section className="resumo-projeto" aria-label="Resumo do projeto">
      <div className="resumo-topo">
        {blob && <img ref={refMiniatura} className="resumo-miniatura" alt="Prévia da placa 1 do projeto" />}
        <div className="resumo-origem">
          <p className="resumo-arquivo" title={nomeArquivo}>
            {nomeArquivo}
          </p>
          <div className="resumo-impressora">
            {capa ? (
              <img className="capa-impressora" src={capa} alt="" width={72} height={72} />
            ) : (
              <span className="capa-impressora" aria-hidden="true" />
            )}
            <div>
              <p className="nota">Impressora de origem</p>
              <p className="opcao-titulo">{resumo.impressora ?? "Não informada"}</p>
              <p className="nota">
                {resumo.slicer}
                {resumo.versaoSlicer ? ` ${resumo.versaoSlicer}` : ""}
              </p>
            </div>
          </div>
          {detalhes.length > 0 && <p className="nota">{detalhes.join(" · ")}</p>}
        </div>
      </div>

      <h3 className="titulo-grupo">
        {resumo.filamentos.length} {resumo.filamentos.length === 1 ? "filamento" : "filamentos"}
      </h3>
      <ol className="lista-filamentos">
        {resumo.filamentos.map((f, i) => (
          <li key={i}>
            <span
              className={`amostra-cor${f.cor ? "" : " sem-cor"}`}
              style={f.cor ? { backgroundColor: f.cor, color: corDoTexto(f.cor) } : undefined}
              title={f.cor ?? undefined}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span>
              <span className="filamento-tipo">{f.tipo ?? "Tipo não informado"}</span>
              {f.nome && (
                <span className="nota filamento-nome" title={f.nome}>
                  {f.nome}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
