/** esbuild bundles *.tpl files as plain text (the harness written into each run folder). */
declare module "*.tpl" {
  const content: string;
  export default content;
}
