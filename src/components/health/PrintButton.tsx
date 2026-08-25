'use client';

// window.print() needs a client boundary; the report page itself stays a
// server component. In the iOS shell this opens the share/print sheet.

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex-none rounded-card border border-acc-cyan/40 bg-acc-cyan/10 px-4 py-2 text-xs font-bold text-acc-cyan"
    >
      Print / PDF
    </button>
  );
}
