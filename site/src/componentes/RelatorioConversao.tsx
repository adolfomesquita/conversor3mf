import type { ItemRelatorio, Relatorio } from "../servicos/formatos";

function Lista({ itens }: { itens: ItemRelatorio[] }) {
  return (
    <ul className="lista-relatorio">
      {itens.map((i, n) => (
        <li key={n}>
          <span>{i.descricao}</span>
          {i.chave && <code className="chave">{i.chave}</code>}
          {(i.de !== undefined || i.para !== undefined) && (
            <span className="de-para">
              {i.de !== undefined && <span className="de">{i.de || "—"}</span>}
              {i.de !== undefined && i.para !== undefined && <span aria-hidden="true"> → </span>}
              {i.para !== undefined && <span className="para">{i.para || "—"}</span>}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Secao({ titulo, itens, aberta = false }: { titulo: string; itens: ItemRelatorio[]; aberta?: boolean }) {
  if (itens.length === 0) return null;
  return (
    <details className="secao-relatorio" open={aberta}>
      <summary>
        {titulo} <span className="contagem">{itens.length}</span>
      </summary>
      <Lista itens={itens} />
    </details>
  );
}

/** Relatório de validação: o que foi mantido, substituído, descartado e o que exige revisão. */
export function RelatorioConversao({ relatorio: r }: { relatorio: Relatorio }) {
  const ok = r.resumo.situacao === "ok";
  return (
    <div className="relatorio">
      <div className={`aviso ${ok ? "aviso-sucesso" : "aviso-info"}`} role="status">
        {ok
          ? "Conversão sem pendências. Confira o projeto no slicer antes de imprimir."
          : `Conversão feita com ${r.resumo.avisos + r.resumo.revisar} ponto(s) para revisar.`}
      </div>

      <dl className="dados resumo-conversao">
        <dt>Origem</dt>
        <dd>
          {r.origem.slicer}
          {r.origem.versaoSlicer ? ` ${r.origem.versaoSlicer}` : ""}
          {r.origem.impressora ? ` · ${r.origem.impressora}` : ""}
        </dd>
        <dt>Destino</dt>
        <dd>
          {r.destino.impressora} (bico {r.destino.bico} mm) · {r.destino.slicer}
        </dd>
        <dt>Processo</dt>
        <dd>
          {r.processo.nome}
          {!r.processo.exata && ` (altura do projeto: ${r.processo.alturaCamadaProjeto} mm)`}
        </dd>
        <dt>Projeto</dt>
        <dd>
          {r.origem.placas} placa(s), {r.origem.objetos} objeto(s), {r.origem.filamentos} filamento(s)
        </dd>
      </dl>

      {r.avisos.length > 0 && (
        <div className="avisos-relatorio">
          <h3>Atenção</h3>
          <ul>
            {r.avisos.map((a, i) => (
              <li key={i}>{a.mensagem}</li>
            ))}
          </ul>
        </div>
      )}

      <h3>Filamentos</h3>
      <div className="tabela-rolavel">
        <table className="tabela-filamentos">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Cor</th>
              <th scope="col">Origem</th>
              <th scope="col">Destino</th>
            </tr>
          </thead>
          <tbody>
            {r.filamentos.map((f) => (
              <tr key={f.indice}>
                <td>{f.indice}</td>
                <td>
                  <span className="amostra-cor" style={{ background: f.cor }} aria-hidden="true" /> {f.cor}
                </td>
                <td>
                  {f.tipoOrigem}
                  {f.perfilOrigem && <span className="nota"> · {f.perfilOrigem}</span>}
                </td>
                <td>
                  {f.perfilDestino}
                  {!f.equivalenciaExata && <span className="selo selo-alerta">aproximado</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Secao titulo="Revisar" itens={r.revisar} aberta />
      <Secao titulo="Substituído" itens={r.substituidos} />
      <Secao titulo="Mantido" itens={r.mantidos} />
      <Secao titulo="Descartado" itens={r.descartados} />
      <p className="nota">Perfis do destino: pacote {r.destino.versaoPacotePerfis}.</p>
    </div>
  );
}
