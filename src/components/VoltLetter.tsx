// The giant outlined day letter, as vector paths — deliberately NOT text.
// On the owner's iPhone the text version rendered as two overlapping
// glyphs (font fallback + WebKit synthetic-bold double-paint over a
// transparent fill with -webkit-text-stroke). Paths cannot be
// synthesized, substituted or double-struck: the outline is the artwork.

const PATHS: Record<'A' | 'B', React.ReactNode> = {
  A: (
    <>
      <path d="M39 8 H61 L92 124 H72 L65 96 H35 L28 124 H8 Z" />
      <path d="M50 30 L61 78 H39 Z" />
    </>
  ),
  B: (
    <>
      <path d="M16 8 H58 C79 8 90 18 90 35 C90 47 85 55 76 60 C87 65 94 74 94 92 C94 112 82 124 60 124 H16 Z" />
      <path d="M34 26 H55 C66 26 72 30 72 40 C72 50 66 54 55 54 H34 Z" />
      <path d="M34 70 H57 C70 70 76 76 76 87 C76 99 70 106 57 106 H34 Z" />
    </>
  ),
};

export default function VoltLetter({
  letter,
  className,
  stroke,
  strokeWidth = 3.5,
}: {
  letter: 'A' | 'B';
  className?: string;
  stroke: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 100 132"
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      {PATHS[letter]}
    </svg>
  );
}
