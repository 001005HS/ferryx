export function resolveMarkdownDocumentPath(resolvedPath: string, relativePath: string): string {
  const cleanRelative = relativePath.split(/[?#]/)[0] ?? "";
  const isWindows = resolvedPath.includes("\\");

  const pathParts = resolvedPath.split(/[/\\]/);
  pathParts.pop();

  const segments = [...pathParts];
  let minLength = 0;
  if (resolvedPath.startsWith("\\\\") || resolvedPath.startsWith("//")) {
    minLength = 4;
  } else if (segments[0] === "" || segments[0]?.includes(":")) {
    minLength = 1;
  }

  const relParts = cleanRelative.split(/[/\\]/);
  for (const part of relParts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (segments.length > minLength) {
        segments.pop();
      }
    } else {
      segments.push(part);
    }
  }

  if (isWindows) {
    if (segments.length === 1 && segments[0]?.includes(":")) {
      return `${segments[0]}\\`;
    }
    return segments.join("\\");
  }

  if (segments.length === 1 && segments[0] === "") {
    return "/";
  }
  return segments.join("/");
}
