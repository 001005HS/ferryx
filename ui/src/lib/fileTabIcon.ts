export type FileTabIconKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "code"
  | "table"
  | "notebook"
  | "text";

const EXTENSION_MAP: Record<string, FileTabIconKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  svg: "image",

  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  ogv: "video",

  mp3: "audio",
  m4a: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  ogg: "audio",
  opus: "audio",
  oga: "audio",

  pdf: "pdf",

  md: "markdown",
  markdown: "markdown",

  csv: "table",
  tsv: "table",

  ipynb: "notebook",

  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  mjs: "code",
  cjs: "code",
  rs: "code",
  py: "code",
  go: "code",
  java: "code",
  c: "code",
  h: "code",
  cpp: "code",
  hpp: "code",
  cs: "code",
  rb: "code",
  php: "code",
  swift: "code",
  kt: "code",
  sh: "code",
  json: "code",
  yaml: "code",
  yml: "code",
  toml: "code",
  css: "code",
  html: "code",
  xml: "code",
  sql: "code",
};

export function fileTabIconKind(path: string): FileTabIconKind {
  if (typeof path !== "string" || !path) {
    return "text";
  }
  const filename = path.split(/[/\\]/).pop() ?? "";
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) {
    return "text";
  }
  const ext = filename.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_MAP[ext] ?? "text";
}
