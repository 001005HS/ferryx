import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronRight, Copy } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  ActivityIndicator,
  ActivityState,
  ApprovalActionCard,
  ApprovalActionCardProps,
  AttachmentList,
  ChatAttachment,
  ChatWorkItem,
  ThinkingBlock,
  ToolCallCard,
} from "./MobileChatComponents";

export interface MobileChatMessageProps {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string | number;
  avatarUrl?: string;
  senderName?: string;
  attachments?: ChatAttachment[];
  toolCalls?: ChatWorkItem[];
  approvalAction?: ApprovalActionCardProps;
  activityState?: ActivityState;
  durationLabel?: string;
  className?: string;
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const InlineCode: React.FC<CodeBlockProps> = ({ className, children, ...props }) => {
  return (
    <code
      className={cn(
        "bg-[#1a1b1b] text-[#4bb8f0] px-1.5 py-0.5 rounded font-mono text-xs",
        className
      )}
      {...props}
    >
      {children}
    </code>
  );
};

const CodeBlock: React.FC<CodeBlockProps> = ({ className, children, ...props }) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const codeText = String(children).replace(/\n$/, "");

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-2.5 rounded-xl border border-[#191919] bg-[#0a0a0a]/90 overflow-hidden shadow-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#111111]/60 border-b border-[#191919] text-[11px] font-mono text-[#838383]">
        <span className="uppercase text-[10px] tracking-wider text-[#818181] font-semibold">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-[#838383] hover:text-[#f5f5f5] transition-colors p-1 rounded hover:bg-white/5"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 font-sans">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span className="font-sans">Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto p-3 text-[11px] font-mono text-[#f5f5f5] leading-relaxed scrollbar-thin scrollbar-thumb-[#191919]">
        <pre className="!bg-transparent !p-0 !m-0">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      </div>
    </div>
  );
};

function formatTimestamp(timestamp?: string | number): string | null {
  if (!timestamp) return null;
  if (typeof timestamp === "string" && !/^\d+$/.test(timestamp)) {
    return timestamp;
  }
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface WorkRowsContainerProps {
  children: React.ReactNode;
  count: number;
}

const WorkRowsContainer: React.FC<WorkRowsContainerProps> = ({ children, count }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const checkOverflow = () => {
      setOverflows(el.scrollHeight > el.clientHeight);
    };
    checkOverflow();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(checkOverflow);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [children, count]);

  const shouldFade = count > 8 || overflows;

  return (
    <div
      ref={containerRef}
      style={
        shouldFade
          ? {
              maskImage:
                "linear-gradient(to bottom, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
            }
          : undefined
      }
      className="flex flex-col gap-px max-h-64 overflow-y-auto w-full my-1 scrollbar-thin"
    >
      {children}
    </div>
  );
};

export const MobileChatMessage: React.FC<MobileChatMessageProps> = ({
  role,
  content,
  timestamp,
  attachments = [],
  toolCalls = [],
  approvalAction,
  activityState,
  durationLabel,
  className,
}) => {
  const isUser = role === "user";
  const formattedTime = formatTimestamp(timestamp);
  const [copied, setCopied] = useState(false);
  const [workExpanded, setWorkExpanded] = useState(false);
  const hasProse = Boolean(content && content.trim().length > 0);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const metaRow = (
    <div className="flex items-center gap-1.5">
      {formattedTime && (
        <span className="font-mono text-xs text-[#838383] select-none">
          {formattedTime}
        </span>
      )}
      <button
        type="button"
        data-testid="message-copy-button"
        onClick={handleCopy}
        title="Copy message"
        className="p-0.5 rounded text-[#818181] hover:text-[#838383] hover:bg-[#1a1b1b]/60 transition-colors"
      >
        {copied ? (
          <Check className="size-3 text-emerald-400" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
    </div>
  );

  if (isUser) {
    return (
      <div
        className={cn(
          "mb-5 flex flex-col items-end gap-1 max-w-[88%] ml-auto",
          className
        )}
      >
        <div
          data-testid="user-message-bubble"
          className="min-w-0 gap-2 rounded-[20px] px-3.5 py-2.5 bg-[#161616] text-[#f5f5f5] leading-relaxed text-base break-words select-text"
        >
          <p className="whitespace-pre-wrap">{content}</p>
          {attachments.length > 0 && (
            <AttachmentList attachments={attachments} className="mt-1" />
          )}
        </div>
        {metaRow}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1 my-2 max-w-[94%] mr-auto",
        className
      )}
    >
      {durationLabel && (
        <button
          type="button"
          data-testid="worked-for-toggle"
          aria-expanded={workExpanded}
          onClick={() => setWorkExpanded((prev) => !prev)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono text-[#838383] hover:text-[#f5f5f5]"
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform duration-[180ms] ease-out",
              workExpanded && "rotate-90"
            )}
          />
          <span>Worked for {durationLabel}</span>
        </button>
      )}

      {(!durationLabel || workExpanded) &&
        toolCalls &&
        toolCalls.length > 0 && (
          <WorkRowsContainer count={toolCalls.length}>
            {toolCalls.map((tc, index) =>
              tc.kind === "thinking" ? (
                <ThinkingBlock key={tc.workKey ?? `thinking-${index}`} text={tc.text} source={tc.source} />
              ) : (
                <ToolCallCard key={tc.workKey ?? `${tc.toolName}-${index}`} {...tc} />
              ),
            )}
          </WorkRowsContainer>
        )}

      {hasProse && (
        <div
          data-testid="assistant-message-body"
          className="w-full text-[#f5f5f5] leading-relaxed text-base break-words select-text"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: ({ node, inline, className, children, ...props }: any) => {
                const contentStr = String(children);
                const hasLang = Boolean(className && (className.startsWith("language-") || /language-(\w+)/.test(className)));
                const hasNewline = contentStr.includes("\n");
                const isFenced = hasLang || inline === false || (inline === undefined && hasNewline);
                const isPureInline = !hasLang && !hasNewline && (inline === true || inline === undefined);

                if (isPureInline && !isFenced) {
                  return (
                    <InlineCode className={className} {...props}>
                      {children}
                    </InlineCode>
                  );
                }
                return (
                  <CodeBlock className={className} {...props}>
                    {children}
                  </CodeBlock>
                );
              },
              pre: ({ children }: any) => <>{children}</>,
              p: ({ children }: any) => {
                const childArray = React.Children.toArray(children);
                const hasBlockChild = childArray.some(
                  (child) =>
                    React.isValidElement(child) &&
                    (child.type === CodeBlock ||
                      (typeof child.type === "string" && ["div", "pre", "blockquote", "ul", "ol", "table"].includes(child.type)))
                );
                if (hasBlockChild) {
                  return <div className="mb-2 last:mb-0">{children}</div>;
                }
                return <p className="mb-2 last:mb-0">{children}</p>;
              },
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#346bf1] hover:text-[#346bf1]/80 underline underline-offset-2"
                >
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-[#191919] pl-2.5 my-2 text-[#838383] italic">
                  {children}
                </blockquote>
              ),
            }}
          >
            {content}
          </ReactMarkdown>

          {attachments.length > 0 && (
            <AttachmentList attachments={attachments} className="mt-2" />
          )}
        </div>
      )}

      {approvalAction && (
        <div className="w-full mt-1.5">
          <ApprovalActionCard {...approvalAction} />
        </div>
      )}

      {activityState && activityState !== "idle" && (
        <div className="mt-2">
          <ActivityIndicator state={activityState} />
        </div>
      )}

      {hasProse && metaRow}
    </div>
  );
};
