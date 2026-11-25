// Tipos dos shims do vite-plugin-node-polyfills (o pacote não os expõe pelos "exports").
declare module "vite-plugin-node-polyfills/shims/buffer" {
  export { Buffer } from "node:buffer";
}
declare module "vite-plugin-node-polyfills/shims/process" {
  const processo: NodeJS.Process;
  export default processo;
}
