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

export interface ChatAttachment {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly url?: string;
  readonly file?: File;
}

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
  readonly quickActions?: readonly unknown[];
  readonly onSelectQuickAction?: (action: any) => void;
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
  placeholder = "Ask the repo agent, or run a command...",
  quickActions: _quickActions,
  onSelectQuickAction: _onSelectQuickAction,
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
          size: file.size,
          type: file.type,
          url,
          file,
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
        "flex flex-col w-full bg-[rgba(10,10,10,0.92)] border-t border-[rgba(25,25,25,0.8)] rounded-2xl backdrop-blur-md pb-safe select-none",
        className
      )}
    >
      {attachments.length > 0 && (
        <div
          data-testid="chat-composer-attachments-blocked"
          className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs text-destructive bg-destructive/10 border-b border-destructive/20"
        >
          <span>Attachments aren&apos;t supported from the phone yet. Remove them to send.</span>
        </div>
      )}
      {attachments.length > 0 && (
        <div
          data-testid="chat-composer-attachments"
          className="flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto no-scrollbar"
        >
          {attachments.map((att) => {
            const isImage = att.type.startsWith("image/") && att.url;
            return (
              <div
                key={att.id}
                data-testid={`attachment-preview-${att.id}`}
                className="group relative flex items-center gap-2 rounded-lg bg-[#111111]/90 border border-border/80 p-1.5 pr-2.5 shrink-0 max-w-[200px] shadow-sm"
              >
                {isImage ? (
                  <img
                    src={att.url}
                    alt={att.name}
                    className="size-8 rounded object-cover bg-[#0a0a0a] border border-border/60"
                  />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded bg-secondary/40 text-muted-foreground border border-border/50">
                    <FileText className="size-4" />
                  </div>
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate text-xs font-mono font-medium text-foreground">
                    {att.name}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {formatFileSize(att.size)}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`remove-attachment-${att.id}`}
                  onClick={() => handleRemoveAttachment(att.id)}
                  className="size-5 rounded-md bg-secondary/60 hover:bg-destructive/80 hover:text-destructive-foreground text-muted-foreground flex items-center justify-center shrink-0 transition-colors"
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
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:bg-secondary/60 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <Plus className="size-4" />
        </button>

        <div className="relative flex min-h-[38px] flex-1 items-center rounded-xl bg-[rgba(26,27,27,0.9)] border border-[rgba(25,25,25,0.8)] focus-within:border-[#346bf1]/80 focus-within:ring-1 focus-within:ring-[#346bf1]/30 px-[14px] pb-2.5 pt-1.5 transition-all">
          <textarea
            ref={textareaRef}
            data-testid="chat-composer-textarea"
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            className="w-full resize-none bg-transparent font-sans text-sm text-[#f5f5f5] placeholder:text-[#838383] focus:outline-none max-h-36 overflow-y-auto leading-relaxed scrollbar-thin"
          />
        </div>

        <button
          type="button"
          data-testid="mic-button"
          disabled
          aria-label="Voice input is not supported"
          title="Voice input is not supported"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:bg-secondary/60 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <Mic className="size-4" />
        </button>

        {isRunning ? (
          <button
            type="button"
            data-testid="stop-button"
            onClick={onStop}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 active:scale-95 transition-all"
          >
            <Square className="size-4 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="send-button"
            disabled={!canSubmit}
            onClick={handleSend}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full transition-all active:scale-95 shadow-sm",
              canSubmit
                ? "bg-[#346bf1] text-[#ffffff] hover:brightness-110 active:brightness-95"
                : "bg-secondary/40 text-muted-foreground/50 border border-border/40 cursor-not-allowed"
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
