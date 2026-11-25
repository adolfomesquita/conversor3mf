// Contagem de uso pelo GoatCounter (sem cookies), sem carregar o script deles: o pedido é montado aqui.
// Vai só o que está nos parâmetros abaixo; o nome e o conteúdo do arquivo nunca entram.
// Formato do pedido: https://www.goatcounter.com/help/pixel
import { CONFIGURACAO } from "../configuracao";

/** Não conta em desenvolvimento, em endereço local, dentro de outra página nem quando o navegador pede para não rastrear. */
function podeContar(): boolean {
  if (!CONFIGURACAO.estatistica || !import.meta.env.PROD) return false;
  if (location.protocol !== "https:") return false;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/.test(location.hostname)) return false;
  if (window.self !== window.top) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === "1" || nav.globalPrivacyControl === true) return false;
  return true;
}

function enviar(parametros: Record<string, string>): void {
  if (!podeContar()) return;
  if (navigator.webdriver) parametros.b = "153";
  parametros.rnd = Math.random().toString(36).slice(2);
  const url = `${CONFIGURACAO.estatistica}?${new URLSearchParams(parametros).toString()}`;
  try {
    if (navigator.sendBeacon?.(url)) return;
  } catch {
    // cai no plano B abaixo
  }
  const img = new Image(1, 1);
  img.referrerPolicy = "no-referrer";
  img.src = url;
}

/** Uma visita à página (conta quando a aba fica visível, não em pré-carregamento). */
export function contarVisita(): void {
  const mandar = () =>
    enviar({
      p: "/",
      t: document.title,
      r: document.referrer,
      s: String(window.screen.width),
    });
  if (document.visibilityState === "visible") {
    mandar();
    return;
  }
  const aoMudar = () => {
    if (document.visibilityState !== "visible") return;
    document.removeEventListener("visibilitychange", aoMudar);
    mandar();
  };
  document.addEventListener("visibilitychange", aoMudar);
}

/** Um evento ("convertido: Bambu Lab P1S", "erro na conversão"). O nome não pode começar com "/". */
export function contarEvento(nome: string): void {
  enviar({ p: nome.replace(/^\/+/, "").slice(0, 200), e: "true" });
}
