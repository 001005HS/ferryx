import { useEffect } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "../ui/button";

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 first:mt-0 text-base font-semibold tracking-tight text-foreground">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 first:mt-0 text-sm font-semibold tracking-tight text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 text-sm font-medium text-foreground">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-muted-foreground">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 list-decimal pl-5 space-y-1 text-sm text-muted-foreground">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
};

export function WhatsNewDialog(props: {
  version: string;
  notes: string;
  onClose: () => void;
}): JSX.Element {
  const { version, notes, onClose } = props;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="What's new in Ferryx"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col p-6">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          What's new in Ferryx {version}
        </h2>
        <div className="mt-4 overflow-y-auto max-h-[60vh] pr-1">
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {notes}
          </Markdown>
        </div>
        <div className="mt-6 flex justify-end">
          <Button data-testid="whats-new-close" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
