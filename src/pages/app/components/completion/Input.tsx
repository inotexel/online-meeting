import { Loader2, XIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  ScrollArea,
  Input as InputComponent,
  Markdown,
  Switch,
  CopyButton,
} from "@/components";
import { UseCompletionReturn } from "@/types";
import { MessageHistory } from "./MessageHistory";

function AskInputField({
  inputRef,
  placeholder,
  input,
  setInput,
  handleKeyPress,
  handlePaste,
  isLoading,
  isHidden,
  embedded,
  currentConversationId,
  conversationHistory,
  startNewConversation,
  messageHistoryOpen,
  setMessageHistoryOpen,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  placeholder: string;
  input: string;
  setInput: (value: string) => void;
  handleKeyPress: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  isLoading: boolean;
  isHidden: boolean;
  embedded?: boolean;
  currentConversationId: string | null;
  conversationHistory: UseCompletionReturn["conversationHistory"];
  startNewConversation: () => void;
  messageHistoryOpen: boolean;
  setMessageHistoryOpen: (open: boolean) => void;
}) {
  const hasHistory =
    Boolean(currentConversationId) && conversationHistory.length > 0;

  return (
    <div className="relative select-none">
      <InputComponent
        ref={inputRef}
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={handleKeyPress}
        onPaste={handlePaste}
        disabled={isLoading || isHidden}
        className={
          embedded
            ? `h-10 w-full text-sm ${hasHistory ? "pr-14" : "pr-3"}`
            : hasHistory
              ? "pr-14"
              : "pr-2"
        }
      />

      {hasHistory && !isLoading && (
        <div className="absolute select-none right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <MessageHistory
            conversationHistory={conversationHistory}
            currentConversationId={currentConversationId!}
            onStartNewConversation={startNewConversation}
            messageHistoryOpen={messageHistoryOpen}
            setMessageHistoryOpen={setMessageHistoryOpen}
          />
        </div>
      )}

      {isLoading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 animate-pulse">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function ResponseToolbar({
  response,
  isLoading,
  keepEngaged,
  setKeepEngaged,
  inputRef,
  cancel,
  reset,
  startNewConversation,
  compact = false,
}: {
  response: string;
  isLoading: boolean;
  keepEngaged: boolean;
  setKeepEngaged: (value: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  cancel: () => void;
  reset: () => void;
  startNewConversation: () => void;
  compact?: boolean;
}) {

  return (
    <div className="flex items-center gap-1.5">
      {!compact && (
        <div className="mr-1 hidden items-center gap-2 sm:flex">
          <p className="text-[10px] text-muted-foreground">
            {keepEngaged ? "Conversation" : "Response"}
          </p>
          <Switch
            checked={keepEngaged}
            onCheckedChange={(checked) => {
              setKeepEngaged(checked);
              setTimeout(() => inputRef?.current?.focus(), 100);
            }}
          />
        </div>
      )}
      <CopyButton content={response} />
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={() => {
          if (isLoading) {
            cancel();
          } else if (keepEngaged) {
            setKeepEngaged(false);
            startNewConversation();
          } else {
            reset();
          }
        }}
        title={
          isLoading
            ? "Cancel"
            : keepEngaged
              ? "Close and start new"
              : "Clear"
        }
      >
        <XIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ResponseBody({
  error,
  isLoading,
  response,
  keepEngaged,
  conversationHistory,
  scrollAreaRef,
  compact = false,
}: {
  error: string | null;
  isLoading: boolean;
  response: string;
  keepEngaged: boolean;
  conversationHistory: UseCompletionReturn["conversationHistory"];
  scrollAreaRef: React.RefObject<HTMLDivElement | null>;
  compact?: boolean;
}) {
  const content = (
    <div className={compact ? "p-2.5" : "p-4"}>
      {error && (
        <div className="mb-2 rounded border border-destructive/20 bg-destructive/10 p-2 text-sm text-destructive">
          <strong>Error:</strong> {error}
        </div>
      )}
      {isLoading && !response && (
        <div className="flex items-center gap-2 text-muted-foreground animate-pulse select-none">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Thinking…</span>
        </div>
      )}
      {response && (
        <div className={compact ? "text-sm" : undefined}>
          <Markdown>{response}</Markdown>
        </div>
      )}

      {keepEngaged && conversationHistory.length > 1 && (
        <div className="space-y-2 pt-2">
          {conversationHistory
            .sort((a, b) => b?.timestamp - a?.timestamp)
            .map((message, index) => {
              if (!isLoading && index === 0) return null;
              return (
                <div
                  key={message.id}
                  className={`rounded-lg p-2.5 text-sm ${
                    message.role === "user"
                      ? "border-l-4 border-primary bg-primary/10"
                      : "bg-muted/50"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      {message.role === "user" ? "You" : "AI"}
                    </span>
                  </div>
                  <div className="text-sm">
                    <Markdown>{message.content}</Markdown>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <div
        ref={scrollAreaRef}
        className="max-h-44 overflow-y-auto overscroll-contain"
      >
        {content}
      </div>
    );
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="h-[calc(100vh-7rem)]">
      {content}
    </ScrollArea>
  );
}

export const Input = ({
  isPopoverOpen,
  isLoading,
  reset,
  input,
  setInput,
  handleKeyPress,
  handlePaste,
  currentConversationId,
  conversationHistory,
  startNewConversation,
  messageHistoryOpen,
  setMessageHistoryOpen,
  error,
  response,
  cancel,
  scrollAreaRef,
  inputRef,
  isHidden,
  keepEngaged,
  setKeepEngaged,
  meetingAskActive = false,
  embedded = false,
}: UseCompletionReturn & { isHidden: boolean; embedded?: boolean }) => {
  const placeholder = meetingAskActive
    ? "Ask about this call, client, or what to say…"
    : "Ask me anything...";

  const showInlineResponse =
    embedded && (isLoading || Boolean(response) || Boolean(error));

  const inputField = (
    <AskInputField
      inputRef={inputRef}
      placeholder={placeholder}
      input={input}
      setInput={setInput}
      handleKeyPress={handleKeyPress}
      handlePaste={handlePaste}
      isLoading={isLoading}
      isHidden={isHidden}
      embedded={embedded}
      currentConversationId={currentConversationId}
      conversationHistory={conversationHistory}
      startNewConversation={startNewConversation}
      messageHistoryOpen={messageHistoryOpen}
      setMessageHistoryOpen={setMessageHistoryOpen}
    />
  );

  if (embedded) {
    return (
      <div className="relative w-full space-y-2">
        {inputField}
        {showInlineResponse && (
          <div className="overflow-hidden rounded-lg border border-border/50 bg-muted/15">
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/25 px-2.5 py-1.5">
              <h3 className="text-xs font-semibold text-foreground">Answer</h3>
              <ResponseToolbar
                response={response}
                isLoading={isLoading}
                keepEngaged={keepEngaged}
                setKeepEngaged={setKeepEngaged}
                inputRef={inputRef}
                cancel={cancel}
                reset={reset}
                startNewConversation={startNewConversation}
                compact
              />
            </div>
            <ResponseBody
              error={error}
              isLoading={isLoading}
              response={response}
              keepEngaged={keepEngaged}
              conversationHistory={conversationHistory}
              scrollAreaRef={scrollAreaRef}
              compact
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex-1">
      <Popover
        open={isPopoverOpen}
        onOpenChange={(open) => {
          if (!open && !isLoading && !keepEngaged) {
            reset();
          }
        }}
      >
        <PopoverTrigger asChild className="!border-none !bg-transparent">
          {inputField}
        </PopoverTrigger>

        <PopoverContent
          align="end"
          side="bottom"
          className="w-screen overflow-hidden border p-0 shadow-lg"
          sideOffset={8}
        >
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
            <div className="flex flex-row items-center gap-1">
              <h3 className="select-none text-xs font-semibold">
                {keepEngaged ? "Conversation Mode" : "AI Response"}
              </h3>
              <div className="text-[10px] text-muted-foreground/70">
                (Use arrow keys to scroll)
              </div>
            </div>
            <ResponseToolbar
              response={response}
              isLoading={isLoading}
              keepEngaged={keepEngaged}
              setKeepEngaged={setKeepEngaged}
              inputRef={inputRef}
              cancel={cancel}
              reset={reset}
              startNewConversation={startNewConversation}
            />
          </div>

          <ResponseBody
            error={error}
            isLoading={isLoading}
            response={response}
            keepEngaged={keepEngaged}
            conversationHistory={conversationHistory}
            scrollAreaRef={scrollAreaRef}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};
