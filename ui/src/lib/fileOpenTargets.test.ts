import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_OPEN_TARGETS,
  classifyFileOpenCategory,
  fileOpenTargetFor,
  loadFileOpenTargets,
  saveFileOpenTargets,
} from "./fileOpenTargets";
import { FILE_OPEN_TARGETS_STORAGE_KEY } from "./storageKeys";

describe("fileOpenTargets", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("classifyFileOpenCategory", () => {
    it("classifies markdown extensions case-insensitively", () => {
      expect(classifyFileOpenCategory("notes.md")).toBe("markdown");
      expect(classifyFileOpenCategory("README.MARKDOWN")).toBe("markdown");
      expect(classifyFileOpenCategory("post.mdx")).toBe("markdown");
      expect(classifyFileOpenCategory("doc.MD")).toBe("markdown");
      expect(classifyFileOpenCategory("doc.MDX")).toBe("markdown");
    });

    it("classifies image extensions case-insensitively", () => {
      expect(classifyFileOpenCategory("shot.png")).toBe("image");
      expect(classifyFileOpenCategory("photo.PNG")).toBe("image");
      expect(classifyFileOpenCategory("image.jpg")).toBe("image");
      expect(classifyFileOpenCategory("image.JPEG")).toBe("image");
      expect(classifyFileOpenCategory("anim.gif")).toBe("image");
      expect(classifyFileOpenCategory("art.webp")).toBe("image");
      expect(classifyFileOpenCategory("icon.bmp")).toBe("image");
      expect(classifyFileOpenCategory("logo.svg")).toBe("image");
      expect(classifyFileOpenCategory("favicon.ico")).toBe("image");
      expect(classifyFileOpenCategory("banner.avif")).toBe("image");
    });

    it("classifies pdf extensions case-insensitively", () => {
      expect(classifyFileOpenCategory("manual.pdf")).toBe("pdf");
      expect(classifyFileOpenCategory("REPORT.PDF")).toBe("pdf");
    });

    it("classifies media extensions case-insensitively", () => {
      expect(classifyFileOpenCategory("video.mp4")).toBe("media");
      expect(classifyFileOpenCategory("clip.MOV")).toBe("media");
      expect(classifyFileOpenCategory("stream.webm")).toBe("media");
      expect(classifyFileOpenCategory("record.m4v")).toBe("media");
      expect(classifyFileOpenCategory("audio.mp3")).toBe("media");
      expect(classifyFileOpenCategory("sound.WAV")).toBe("media");
      expect(classifyFileOpenCategory("track.ogg")).toBe("media");
      expect(classifyFileOpenCategory("song.m4a")).toBe("media");
      expect(classifyFileOpenCategory("lossless.flac")).toBe("media");
    });

    it("classifies other files as text", () => {
      expect(classifyFileOpenCategory("main.ts")).toBe("text");
      expect(classifyFileOpenCategory("script.py")).toBe("text");
      expect(classifyFileOpenCategory("index.html")).toBe("text");
      expect(classifyFileOpenCategory("Makefile")).toBe("text");
      expect(classifyFileOpenCategory(".gitignore")).toBe("text");
      expect(classifyFileOpenCategory("")).toBe("text");
    });

    it("handles Windows paths and paths with dots in folder names", () => {
      expect(classifyFileOpenCategory("C:\\Users\\user\\doc.MD")).toBe("markdown");
      expect(classifyFileOpenCategory("C:\\foo.bar\\photo.PNG")).toBe("image");
      expect(classifyFileOpenCategory("D:\\nested.dir\\manual.PDF")).toBe("pdf");
      expect(classifyFileOpenCategory("E:\\media.folder\\clip.mp4")).toBe("media");
      expect(classifyFileOpenCategory("C:\\path.with.dots\\file.txt")).toBe("text");
      expect(classifyFileOpenCategory("C:\\foo.bar\\README")).toBe("text");
    });
  });

  describe("loadFileOpenTargets", () => {
    it("returns defaults with all categories set to in-app when storage is empty", () => {
      expect(loadFileOpenTargets()).toEqual(DEFAULT_FILE_OPEN_TARGETS);
      expect(loadFileOpenTargets()).toEqual({
        markdown: "in-app",
        image: "in-app",
        pdf: "in-app",
        media: "in-app",
        text: "in-app",
      });
    });

    it("returns defaults when stored JSON is invalid or corrupted", () => {
      localStorage.setItem(FILE_OPEN_TARGETS_STORAGE_KEY, "{corrupt-json");
      expect(loadFileOpenTargets()).toEqual(DEFAULT_FILE_OPEN_TARGETS);
    });

    it("ignores invalid values per key and falls back to defaults for those keys", () => {
      localStorage.setItem(
        FILE_OPEN_TARGETS_STORAGE_KEY,
        JSON.stringify({
          markdown: "external",
          image: "not-a-valid-target",
          pdf: 12345,
          media: null,
          text: "external",
        }),
      );
      expect(loadFileOpenTargets()).toEqual({
        markdown: "external",
        image: "in-app",
        pdf: "in-app",
        media: "in-app",
        text: "external",
      });
    });
  });

  describe("saveFileOpenTargets and round-trip", () => {
    it("persists targets and round-trips correctly", () => {
      const customTargets = {
        markdown: "external" as const,
        image: "external" as const,
        pdf: "in-app" as const,
        media: "external" as const,
        text: "in-app" as const,
      };

      saveFileOpenTargets(customTargets);
      expect(loadFileOpenTargets()).toEqual(customTargets);
    });

    it("persists with injected storage shim", () => {
      const mockStorage: Record<string, string> = {};
      const storageShim = {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = v;
        },
      };

      saveFileOpenTargets(
        {
          markdown: "external",
          image: "in-app",
          pdf: "external",
          media: "in-app",
          text: "external",
        },
        storageShim,
      );

      expect(loadFileOpenTargets(storageShim)).toEqual({
        markdown: "external",
        image: "in-app",
        pdf: "external",
        media: "in-app",
        text: "external",
      });
    });
  });

  describe("fileOpenTargetFor", () => {
    it("returns in-app by default", () => {
      expect(fileOpenTargetFor("docs/readme.md")).toBe("in-app");
      expect(fileOpenTargetFor("images/shot.png")).toBe("in-app");
    });

    it("returns external when category is configured as external", () => {
      saveFileOpenTargets({
        markdown: "in-app",
        image: "external",
        pdf: "in-app",
        media: "in-app",
        text: "in-app",
      });

      expect(fileOpenTargetFor("images/shot.png")).toBe("external");
      expect(fileOpenTargetFor("docs/readme.md")).toBe("in-app");
    });
  });
});
