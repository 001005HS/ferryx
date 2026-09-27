import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MobileChatComposer } from "./MobileChatComposer";

describe("MobileChatComposer", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("renders the T3 composer row with attach, mic, and circular send controls", () => {
    const onSend = vi.fn();
    render(<MobileChatComposer onSend={onSend} />);

    const textarea = screen.getByTestId("chat-composer-textarea");
    expect(textarea).toHaveAttribute(
      "placeholder",
      "Ask the agent…"
    );
    expect(screen.getByTestId("attach-file-button")).toBeInTheDocument();
    expect(screen.getByTestId("mic-button")).toBeDisabled();
    expect(screen.getByTestId("file-upload-input")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-chat-quick-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-accessory-bar")).not.toBeInTheDocument();
  });

  it("renders composer with textarea and handles Korean IME composition safely", () => {
    const onSend = vi.fn();
    render(<MobileChatComposer onSend={onSend} />);

    const textarea = screen.getByTestId("chat-composer-textarea");
    const sendButton = screen.getByTestId("send-button");

    expect(sendButton).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "안녕하세요" } });
    expect(sendButton).not.toBeDisabled();

    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("안녕하세요", []);
  });

  it("toggles between send and stop buttons based on isRunning prop", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <MobileChatComposer onSend={onSend} onStop={onStop} isRunning={false} />
    );

    expect(screen.getByTestId("send-button")).toBeInTheDocument();
    expect(screen.queryByTestId("stop-button")).not.toBeInTheDocument();

    rerender(
      <MobileChatComposer onSend={onSend} onStop={onStop} isRunning={true} />
    );

    expect(screen.queryByTestId("send-button")).not.toBeInTheDocument();
    const stopButton = screen.getByTestId("stop-button");
    expect(stopButton).toBeInTheDocument();

    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does not revoke sent attachment blob URL on send, but revokes unsent draft attachment on removal", () => {
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    let callCount = 0;
    const mockCreateObjectURL = vi.fn().mockImplementation(() => `blob:mock-image-${++callCount}`);
    const mockRevokeObjectURL = vi.fn();
    URL.createObjectURL = mockCreateObjectURL;
    URL.revokeObjectURL = mockRevokeObjectURL;

    try {
      const onSend = vi.fn();
      const { unmount } = render(<MobileChatComposer onSend={onSend} />);

      const fileInput = screen.getByTestId("file-upload-input");
      const file1 = new File(["img1"], "file1.png", { type: "image/png" });
      const file2 = new File(["img2"], "file2.png", { type: "image/png" });

      fireEvent.change(fileInput, { target: { files: [file1, file2] } });

      const removeButtons = screen.getAllByRole("button").filter((btn) =>
        btn.getAttribute("data-testid")?.startsWith("remove-attachment-")
      );
      expect(removeButtons).toHaveLength(2);
      fireEvent.click(removeButtons[1]);
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-image-2");
      expect(mockRevokeObjectURL).not.toHaveBeenCalledWith("blob:mock-image-1");

      const sendButton = screen.getByTestId("send-button");
      expect(sendButton).toBeDisabled();
      fireEvent.click(sendButton);
      expect(onSend).not.toHaveBeenCalled();

      unmount();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-image-1");
    } finally {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });

  it("does not send on Enter when IME is confirming (native isComposing or keyCode 229), but sends on deliberate Enter", () => {
    const onSend = vi.fn();
    render(<MobileChatComposer onSend={onSend} />);

    const textarea = screen.getByTestId("chat-composer-textarea");
    fireEvent.change(textarea, { target: { value: "안녕하세요" } });

    fireEvent.keyDown(textarea, {
      key: "Enter",
      isComposing: true,
    });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, {
      key: "Enter",
      keyCode: 229,
    });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, {
      key: "Enter",
      keyCode: 13,
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("안녕하세요", []);
  });

  it("does not call onSend when clicking send with empty textarea", () => {
    const onSend = vi.fn();
    render(<MobileChatComposer onSend={onSend} />);

    const sendButton = screen.getByTestId("send-button");
    expect(sendButton).toBeDisabled();

    fireEvent.click(sendButton);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend with whitespace-only draft", () => {
    const onSend = vi.fn();
    render(<MobileChatComposer onSend={onSend} />);

    const textarea = screen.getByTestId("chat-composer-textarea");
    const sendButton = screen.getByTestId("send-button");

    fireEvent.change(textarea, { target: { value: "   \n  " } });
    expect(sendButton).toBeDisabled();

    fireEvent.click(sendButton);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps file-upload-input reachable and clickable from the attach control", () => {
    render(<MobileChatComposer onSend={vi.fn()} />);

    const fileInput = screen.getByTestId("file-upload-input") as HTMLInputElement;
    const attachButton = screen.getByTestId("attach-file-button");
    const clickSpy = vi.spyOn(fileInput, "click");

    fireEvent.click(attachButton);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("revokes tracked blob URLs when unmounted", () => {
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    const mockCreateObjectURL = vi.fn().mockReturnValue("blob:unmount-test");
    const mockRevokeObjectURL = vi.fn();
    URL.createObjectURL = mockCreateObjectURL;
    URL.revokeObjectURL = mockRevokeObjectURL;

    try {
      const { unmount } = render(<MobileChatComposer onSend={vi.fn()} />);

      const fileInput = screen.getByTestId("file-upload-input");
      const testFile = new File(["data"], "avatar.png", { type: "image/png" });

      fireEvent.change(fileInput, { target: { files: [testFile] } });
      expect(mockCreateObjectURL).toHaveBeenCalledWith(testFile);

      unmount();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:unmount-test");
    } finally {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});

describe("MobileChatComposer attachments block on send (Option b)", () => {
  let origCreateObjectURL: typeof URL.createObjectURL | undefined;
  let origRevokeObjectURL: typeof URL.revokeObjectURL | undefined;

  beforeEach(() => {
    cleanup();
    if (typeof globalThis.URL !== "undefined") {
      origCreateObjectURL = globalThis.URL.createObjectURL;
      origRevokeObjectURL = globalThis.URL.revokeObjectURL;
      globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
      globalThis.URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
    if (typeof globalThis.URL !== "undefined") {
      if (origCreateObjectURL) {
        globalThis.URL.createObjectURL = origCreateObjectURL;
      }
      if (origRevokeObjectURL) {
        globalThis.URL.revokeObjectURL = origRevokeObjectURL;
      }
    }
  });

  it("blocks sending when attachments are present and displays warning message", () => {
    const onSend = vi.fn();
    render(<MobileChatComposer onSend={onSend} />);

    const textarea = screen.getByTestId("chat-composer-textarea");
    fireEvent.change(textarea, { target: { value: "Hello with attachment" } });

    const fileInput = screen.getByTestId("file-upload-input");
    const testFile = new File(["sample content"], "test-doc.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    const warning = screen.getByTestId("chat-composer-attachments-blocked");
    expect(warning.textContent).toContain("Attachments aren't supported from the phone yet. Remove them to send.");

    const sendButton = screen.getByTestId("send-button");
    expect(sendButton).toBeDisabled();

    fireEvent.click(sendButton);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("allows send once attachments are removed", () => {
    const onSend = vi.fn();
    render(<MobileChatComposer onSend={onSend} />);

    const textarea = screen.getByTestId("chat-composer-textarea");
    fireEvent.change(textarea, { target: { value: "Now without attachment" } });

    const fileInput = screen.getByTestId("file-upload-input");
    const testFile = new File(["sample content"], "image.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    expect(screen.getByTestId("chat-composer-attachments-blocked")).toBeInTheDocument();
    const sendButton = screen.getByTestId("send-button");
    expect(sendButton).toBeDisabled();

    const removeButtons = screen.getAllByRole("button").filter((btn) =>
      btn.getAttribute("data-testid")?.startsWith("remove-attachment-")
    );
    expect(removeButtons).toHaveLength(1);
    fireEvent.click(removeButtons[0]);

    expect(screen.queryByTestId("chat-composer-attachments-blocked")).not.toBeInTheDocument();
    expect(sendButton).not.toBeDisabled();

    fireEvent.click(sendButton);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Now without attachment", []);
  });
});
