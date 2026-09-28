import { describe, expect, it } from "vitest";
import { fileTabIconKind } from "./fileTabIcon";

describe("fileTabIconKind", () => {
  it("classifies image extensions", () => {
    const extensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"];
    for (const ext of extensions) {
      expect(fileTabIconKind(`/path/to/asset.${ext}`)).toBe("image");
    }
  });

  it("classifies video extensions", () => {
    const extensions = ["mp4", "m4v", "mov", "webm", "ogv"];
    for (const ext of extensions) {
      expect(fileTabIconKind(`/media/clip.${ext}`)).toBe("video");
    }
  });

  it("classifies audio extensions", () => {
    const extensions = ["mp3", "m4a", "wav", "flac", "aac", "ogg", "opus", "oga"];
    for (const ext of extensions) {
      expect(fileTabIconKind(`/sound/track.${ext}`)).toBe("audio");
    }
  });

  it("classifies pdf files", () => {
    expect(fileTabIconKind("document.pdf")).toBe("pdf");
    expect(fileTabIconKind("/var/docs/manual.PDF")).toBe("pdf");
  });

  it("classifies markdown files", () => {
    expect(fileTabIconKind("README.md")).toBe("markdown");
    expect(fileTabIconKind("guide.markdown")).toBe("markdown");
  });

  it("classifies table files", () => {
    expect(fileTabIconKind("sheet.csv")).toBe("table");
    expect(fileTabIconKind("data.tsv")).toBe("table");
  });

  it("classifies notebook files", () => {
    expect(fileTabIconKind("experiment.ipynb")).toBe("notebook");
  });

  it("classifies code extensions", () => {
    const extensions = [
      "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go",
      "java", "c", "h", "cpp", "hpp", "cs", "rb", "php", "swift",
      "kt", "sh", "json", "yaml", "yml", "toml", "css", "html",
      "xml", "sql",
    ];
    for (const ext of extensions) {
      expect(fileTabIconKind(`file.${ext}`)).toBe("code");
    }
  });

  it("handles case insensitivity", () => {
    expect(fileTabIconKind("/path/FILE.PNG")).toBe("image");
    expect(fileTabIconKind("/path/MAIN.TSX")).toBe("code");
    expect(fileTabIconKind("/path/DOC.MD")).toBe("markdown");
  });

  it("handles windows paths", () => {
    expect(fileTabIconKind("C:\\Users\\dev\\project\\icon.svg")).toBe("image");
    expect(fileTabIconKind("D:\\repo\\script.py")).toBe("code");
  });

  it("defaults to text for unknown extensions or files without extension", () => {
    expect(fileTabIconKind("LICENSE")).toBe("text");
    expect(fileTabIconKind("Makefile")).toBe("text");
    expect(fileTabIconKind("unknown.xyz")).toBe("text");
    expect(fileTabIconKind("notes.txt")).toBe("text");
    expect(fileTabIconKind(".gitignore")).toBe("text");
    expect(fileTabIconKind("")).toBe("text");
  });
});
