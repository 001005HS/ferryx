export interface WrappedRow {
  text: string;
}

function continuesInto(from: WrappedRow, to: WrappedRow, cols: number): boolean {
  if (cols <= 0 || from.text.length < cols || from.text.length === 0 || to.text.length === 0) {
    return false;
  }
  const lastChar = from.text[from.text.length - 1];
  const firstChar = to.text[0];
  return !/\s/.test(lastChar) && !/\s/.test(firstChar);
}

export function stitchHardWrappedLine(
  prev: WrappedRow | null,
  current: WrappedRow,
  next: WrappedRow | null,
  col: number,
  cols: number,
): { text: string; col: number } {
  let text = current.text;
  let resultCol = col;

  if (prev !== null && continuesInto(prev, current, cols)) {
    text = prev.text + text;
    resultCol += prev.text.length;
  }

  if (next !== null && continuesInto(current, next, cols)) {
    text = text + next.text;
  }

  return { text, col: resultCol };
}
