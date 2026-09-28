import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { parseNotebook, type NotebookCell, type NotebookOutput } from "../lib/ipynbParse";

function OutputItem({ output }: { output: NotebookOutput }) {
  if (output.kind === "text") {
    return (
      <pre className="font-mono text-xs text-zinc-300 bg-zinc-950/60 p-2 rounded whitespace-pre-wrap overflow-x-auto">
        {output.text}
      </pre>
    );
  }

  if (output.kind === "image") {
    return (
      <div className="py-1">
        <img
          src={`data:${output.mime};base64,${output.base64}`}
          alt="Cell output"
          className="max-w-full h-auto rounded"
        />
      </div>
    );
  }

  if (output.kind === "error") {
    return (
      <div className="bg-red-950/40 border border-red-800/60 text-red-200 p-2.5 rounded font-mono text-xs whitespace-pre-wrap overflow-x-auto">
        <div className="font-semibold text-red-400 mb-1">{output.name}</div>
        <div>{output.message}</div>
      </div>
    );
  }

  return null;
}

function MarkdownCell({ cell }: { cell: NotebookCell }) {
  return (
    <div
      data-testid="notebook-cell"
      data-kind="markdown"
      className="prose prose-invert prose-sm max-w-none text-zinc-200 leading-relaxed px-4 py-2"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {cell.source}
      </ReactMarkdown>
    </div>
  );
}

function CodeCell({ cell }: { cell: NotebookCell }) {
  const executionLabel = cell.executionCount !== null ? `In [${cell.executionCount}]:` : "In [ ]:";

  return (
    <div
      data-testid="notebook-cell"
      data-kind="code"
      className="my-2 border border-zinc-800/70 bg-zinc-900/50 rounded-md overflow-hidden"
    >
      <div className="flex items-start text-xs font-mono">
        <span className="w-16 flex-shrink-0 text-right pr-3 pt-2 text-zinc-500 select-none">
          {executionLabel}
        </span>
        <pre className="flex-1 font-mono text-xs text-zinc-200 p-2 overflow-x-auto whitespace-pre">
          {cell.source}
        </pre>
      </div>

      {cell.outputs.length > 0 && (
        <div className="border-t border-zinc-800/50 bg-zinc-950/40 p-3 space-y-2">
          {cell.outputs.map((output, idx) => (
            <OutputItem key={idx} output={output} />
          ))}
        </div>
      )}
    </div>
  );
}

function RawCell({ cell }: { cell: NotebookCell }) {
  return (
    <div
      data-testid="notebook-cell"
      data-kind="raw"
      className="my-2 p-3 bg-zinc-900/30 border border-zinc-800/40 rounded-md"
    >
      <pre className="font-mono text-xs text-zinc-400 whitespace-pre-wrap overflow-x-auto">
        {cell.source}
      </pre>
    </div>
  );
}

export function FilePreviewNotebook({ text }: { text: string }) {
  const notebook = parseNotebook(text);

  if (!notebook) {
    return (
      <div className="p-4 text-center">
        <p data-testid="file-preview-notebook-invalid" className="text-sm text-red-400 font-medium">
          Invalid or unreadable Jupyter notebook.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="file-preview-notebook"
      className="w-full h-full overflow-y-auto p-4 space-y-3 bg-zinc-950 text-zinc-100"
    >
      {notebook.cells.map((cell, idx) => {
        if (cell.kind === "markdown") {
          return <MarkdownCell key={idx} cell={cell} />;
        }
        if (cell.kind === "code") {
          return <CodeCell key={idx} cell={cell} />;
        }
        return <RawCell key={idx} cell={cell} />;
      })}
    </div>
  );
}
