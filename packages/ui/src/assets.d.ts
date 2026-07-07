// Ambient module declarations for static image imports processed by the
// consuming Vite app (packages/ui is consumed as source, so `import x from
// './foo.png'` resolves to a URL string at build time). Self-contained so
// `tsc --noEmit` in this package doesn't depend on `vite/client` resolving.

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}
