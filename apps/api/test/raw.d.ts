// Vite's `?raw` imports: the file's text, as the tests compare generated files with it.
declare module "*?raw" {
  const text: string;
  export default text;
}
