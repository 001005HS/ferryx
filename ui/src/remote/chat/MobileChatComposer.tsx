import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Mic,
  Plus,
  Square,
  X,
  FileText,
} from "lucide-react";
import { cn } from "../../lib/cn";
import type { ChatAttachment } from "./MobileChatComponents";

export type { ChatAttachment };

export interface MobileChatComposerHandle {
  clearDraft: () => void;
}

export interface MobileChatComposerProps {
  readonly onSend: (text: string, attachments: readonly ChatAttachment[]) => void;
  readonly onStop?: () => void;
  readonly onClearDraft?: () => void;
  readonly isRunning?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MobileChatComposer = React.forwardRef<
  MobileChatComposerHandle,
  MobileChatComposerProps
>(({
  onSend,
  onStop,
  onClearDraft,
  isRunning = false,
  disabled = false,
  placeholder = "Ask the agent…",
  className,
}, ref) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<readonly ChatAttachment[]>([]);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const revokeTrackedUrl = useCallback((url?: string) => {
    if (!url) return;
    if (objectUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(url);
    }
  }, []);

  const revokeAllTrackedUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    objectUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      revokeAllTrackedUrls();
    };
  }, [revokeAllTrackedUrls]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, 144);
    el.style.height = `${Math.max(nextHeight, 36)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  const clearDraft = useCallback(() => {
    setText("");
    setAttachments([]);
    revokeAllTrackedUrls();
    if (textareaRef.current) {
      textareaRef.current.style.height = "36px";
    }
    onClearDraft?.();
  }, [revokeAllTrackedUrls, onClearDraft]);

  React.useImperativeHandle(ref, () => ({
    clearDraft,
  }), [clearDraft]);

  const handleSend = useCallback(() => {
    if (disabled) return;
    if (attachments.length > 0) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, []);
    setText("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "36px";
    }
  }, [disabled, text, attachments, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        if (
          isComposingRef.current ||
          Boolean(e.nativeEvent?.isComposing) ||
          Boolean((e as unknown as { isComposing?: boolean }).isComposing) ||
          e.keyCode === 229 ||
          (e.nativeEvent as KeyboardEvent | undefined)?.keyCode === 229
        ) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const newAttachments: ChatAttachment[] = Array.from(files).map((file) => {
        const isImage = file.type.startsWith("image/");
        let url: string | undefined;
        if (isImage) {
          url = URL.createObjectURL(file);
          objectUrlsRef.current.add(url);
        }
        return {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          name: file.name,
          size: formatFileSize(file.size),
          type: file.type || "file",
          url,
        };
      });

      setAttachments((prev) => [...prev, ...newAttachments]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    []
  );

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      setAttachments((prev) => {
        const target = prev.find((a) => a.id === id);
        if (target?.url) {
          revokeTrackedUrl(target.url);
        }
        return prev.filter((a) => a.id !== id);
      });
    },
    [revokeTrackedUrl]
  );

  const canSubmit = text.trim().length > 0 && attachments.length === 0 && !disabled;

  return (
    <div
      data-testid="mobile-chat-composer"
      className={cn(
        "flex flex-col w-full bg-chat-composer-panel border-t border-chat-composer-border rounded-2xl backdrop-blur-md pb-safe select-none",
        className
      )}
    >
      {attachments.length > 0 && (
        <div
          data-testid="chat-composer-attachments-blocked"
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs text-chat-danger bg-chat-danger/10 border-b border-chat-danger/20"
        >
          <span>Attachments aren&apos;t supported from the phone yet. Remove them to send.</span>
        </div>
      )}
      {attachments.length > 0 && (
        <div
          data-testid="chat-composer-attachments"
          className="flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto scrollbar-none"
        >
          {attachments.map((att) => {
            const isImage = att.type.startsWith("image/") && att.url;
            return (
              <div
                key={att.id}
                data-testid={`attachment-preview-${att.id}`}
                className="group relative flex items-center gap-2 rounded-lg bg-chat-surface/90 border border-chat-border p-1.5 pr-2.5 shrink-0 max-w-[200px] shadow-sm"
              >
                {isImage ? (
                  <img
                    src={att.url}
                    alt={att.name}
                    className="size-8 rounded object-cover bg-chat-screen border border-chat-border/60"
                  />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded bg-chat-surface-raised/60 text-chat-foreground-secondary border border-chat-border/50">
                    <FileText className="size-4" />
                  </div>
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate text-xs font-mono font-medium text-chat-foreground">
                    {att.name}
                  </span>
                  <span className="text-[10px] font-mono text-chat-foreground-secondary">
                    {att.size}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`remove-attachment-${att.id}`}
                  aria-label={`Remove attachment ${att.name}`}
                  onClick={() => handleRemoveAttachment(att.id)}
                  className="size-5 rounded-md bg-chat-surface-raised hover:bg-chat-danger/80 hover:text-chat-screen text-chat-foreground-secondary flex items-center justify-center shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2 px-[12px] py-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
          data-testid="file-upload-input"
        />

        <button
          type="button"
          data-testid="attach-file-button"
          aria-label="Attach file"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-chat-foreground-secondary hover:text-chat-foreground active:bg-chat-surface-raised transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plus className="size-4" />
        </button>

        <div className="relative flex min-h-[38px] flex-1 items-center rounded-xl bg-chat-composer-surface border border-chat-composer-border focus-within:border-chat-primary/80 focus-within:ring-1 focus-within:ring-chat-primary/30 px-[14px] pb-2.5 pt-1.5 transition-all">
          <textarea
            ref={textareaRef}
            data-testid="chat-composer-textarea"
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            aria-label="Ask the repo agent"
            enterKeyHint="send"
            autoComplete="off"
            inputMode="text"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            className="w-full resize-none bg-transparent font-sans text-base text-chat-foreground placeholder:text-chat-foreground-secondary focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-h-36 overflow-y-auto leading-relaxed scrollbar-sleek"
          />
        </div>

        <button
          type="button"
          data-testid="mic-button"
          disabled
          aria-label="Voice input is not supported"
          title="Voice input is not supported"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-chat-foreground-secondary hover:text-chat-foreground active:bg-chat-surface-raised transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Mic className="size-4" />
        </button>

        {isRunning ? (
          <button
            type="button"
            data-testid="stop-button"
            aria-label="Stop the running turn"
            onClick={onStop}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-chat-danger text-chat-foreground shadow-sm hover:bg-chat-danger/90 active:bg-chat-danger/80 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Square className="size-4 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="send-button"
            aria-label="Send message"
            disabled={!canSubmit}
            onClick={handleSend}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full transition-all active:scale-95 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              canSubmit
                ? "bg-chat-primary text-chat-primary-foreground hover:brightness-110 active:brightness-95"
                : "bg-chat-surface-raised/40 text-chat-foreground-secondary/50 border border-chat-border/40 cursor-not-allowed"
            )}
          >
            <ArrowUp className="size-4 stroke-[2.5]" />
          </button>
        )}
      </div>
    </div>
  );
});

MobileChatComposer.displayName = "MobileChatComposer";
