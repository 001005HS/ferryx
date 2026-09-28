export type MarkdownHeading = {
  level: 1 | 2 | 3;
  text: string;
  slug: string;
};

export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: MarkdownHeading[] = [];
  const occurrences = new Map<string, number>();
  const assigned = new Set<string>();

  let inCodeBlock = false;
  let fenceChar = "";
  let fenceLength = 0;

  for (const line of lines) {
    const trimmedLeft = line.trimStart();
    const indent = line.length - trimmedLeft.length;

    if (indent <= 3) {
      const fenceMatch = trimmedLeft.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        const matchFence = fenceMatch[1];
        const char = matchFence[0];
        const len = matchFence.length;

        if (!inCodeBlock) {
          inCodeBlock = true;
          fenceChar = char;
          fenceLength = len;
          continue;
        } else if (char === fenceChar && len >= fenceLength && trimmedLeft.slice(len).trim() === "") {
          inCodeBlock = false;
          fenceChar = "";
          fenceLength = 0;
          continue;
        }
      }
    }

    if (inCodeBlock) {
      continue;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,3})\s+(.*)$/);
    if (!headingMatch) {
      continue;
    }

    const level = headingMatch[1].length as 1 | 2 | 3;
    let headingText = headingMatch[2].trim();
    headingText = headingText.replace(/\s+#+\s*$/, "").trim();

    if (!headingText) {
      continue;
    }

    let baseSlug = headingText
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}0-9\-_]/gu, "");

    if (!baseSlug) {
      baseSlug = "heading";
    }

    let slug = baseSlug;
    if (!assigned.has(baseSlug)) {
      assigned.add(baseSlug);
      occurrences.set(baseSlug, 0);
    } else {
      let count = (occurrences.get(baseSlug) ?? 0) + 1;
      let candidate = `${baseSlug}-${count}`;
      while (assigned.has(candidate)) {
        count++;
        candidate = `${baseSlug}-${count}`;
      }
      occurrences.set(baseSlug, count);
      assigned.add(candidate);
      slug = candidate;
    }

    headings.push({ level, text: headingText, slug });
  }

  return headings;
}
