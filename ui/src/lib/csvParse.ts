export function detectDelimiter(name: string, text: string): "," | "\t" {
  if (name.toLowerCase().endsWith(".tsv")) {
    return "\t";
  }

  let firstLineEnd = text.indexOf("\n");
  const crIndex = text.indexOf("\r");
  if (firstLineEnd === -1 || (crIndex !== -1 && crIndex < firstLineEnd)) {
    firstLineEnd = crIndex;
  }
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);

  let tabCount = 0;
  let commaCount = 0;
  for (let i = 0; i < firstLine.length; i++) {
    const char = firstLine[i];
    if (char === "\t") {
      tabCount++;
    } else if (char === ",") {
      commaCount++;
    }
  }

  if (tabCount > commaCount) {
    return "\t";
  }
  return ",";
}

export function parseDelimited(text: string, delimiter: "," | "\t"): string[][] {
  if (text.length === 0) {
    return [];
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      }

      if (char === delimiter) {
        currentRow.push(currentField);
        currentField = "";
        i++;
        continue;
      }

      if (char === "\r") {
        if (i + 1 < len && text[i + 1] === "\n") {
          i++;
        }
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i++;
        continue;
      }

      if (char === "\n") {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i++;
        continue;
      }

      currentField += char;
      i++;
    }
  }

  if (currentRow.length > 0 || currentField.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}
