// pdf.js ships no types for its worker bundle; it is imported only for its
// side effect (registering globalThis.pdfjsWorker). See PdfPages.tsx.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
