import * as React from "react";
import { Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea as BaseTextarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
};

type SpeechRecognitionResultLike = {
  isFinal?: boolean;
  0?: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = Event & {
  resultIndex?: number;
  results?: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: ((event: Event) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

type SpeechTextareaProps = React.ComponentPropsWithoutRef<"textarea"> & {
  onValueChange?: (value: string) => void;
  speechEnabled?: boolean;
  speechLang?: string;
};

function setNativeTextareaValue(element: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;

  valueSetter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function addTranscriptAtCursor(
  currentValue: string,
  transcript: string,
  start: number,
  end: number,
) {
  const phrase = transcript.trim();
  if (!phrase) {
    return { nextValue: currentValue, nextCursor: start };
  }

  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const leadingSpace = before && !/\s$/.test(before) ? " " : "";
  const trailingSpace = after && !/^\s/.test(after) ? " " : "";
  const insert = `${leadingSpace}${phrase}${trailingSpace}`;

  return {
    nextValue: `${before}${insert}${after}`,
    nextCursor: before.length + insert.length,
  };
}

function speechErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone access was not allowed. Open the browser permission prompt and allow microphone access to use dictation.";
  }

  if (error === "no-speech") {
    return "No speech was detected. Tap the mic and try again.";
  }

  if (error === "audio-capture") {
    return "No microphone was found on this device.";
  }

  return "Speech to text stopped. Try again when you are ready.";
}

const SpeechTextarea = React.forwardRef<HTMLTextAreaElement, SpeechTextareaProps>(
  (
    {
      className,
      disabled,
      onValueChange,
      readOnly,
      speechEnabled = true,
      speechLang = "en-AU",
      value,
      ...props
    },
    forwardedRef,
  ) => {
    const { toast } = useToast();
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);
    const [isListening, setIsListening] = React.useState(false);

    const setTextareaRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          (
            forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>
          ).current = node;
        }
      },
      [forwardedRef],
    );

    const appendTranscript = React.useCallback(
      (transcript: string) => {
        const textarea = textareaRef.current;
        const currentValue =
          typeof value === "string"
            ? value
            : value == null
              ? textarea?.value ?? ""
              : String(value);
        const start = textarea?.selectionStart ?? currentValue.length;
        const end = textarea?.selectionEnd ?? start;
        const { nextValue, nextCursor } = addTranscriptAtCursor(
          currentValue,
          transcript,
          start,
          end,
        );

        if (nextValue === currentValue) return;

        onValueChange?.(nextValue);

        if (textarea) {
          setNativeTextareaValue(textarea, nextValue);
          requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(nextCursor, nextCursor);
          });
        }
      },
      [onValueChange, value],
    );

    const stopListening = React.useCallback(() => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
    }, []);

    const startListening = React.useCallback(() => {
      if (disabled || readOnly) return;

      const SpeechRecognition =
        (window as SpeechWindow).SpeechRecognition ??
        (window as SpeechWindow).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        toast({
          title: "Speech to text is not available",
          description:
            "Try this from Chrome, Edge or Safari and allow microphone access when prompted.",
          variant: "destructive",
        });
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = speechLang;

      recognition.onresult = (event) => {
        let transcript = "";
        const results = event.results;
        if (!results) return;

        for (let index = event.resultIndex ?? 0; index < results.length; index += 1) {
          const result = results[index];
          if (result?.isFinal !== false) {
            transcript += ` ${result?.[0]?.transcript ?? ""}`;
          }
        }

        appendTranscript(transcript);
      };

      recognition.onerror = (event) => {
        recognitionRef.current = null;
        setIsListening(false);
        toast({
          title: "Dictation stopped",
          description: speechErrorMessage(event.error),
          variant:
            event.error === "no-speech" || !event.error
              ? "default"
              : "destructive",
        });
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        setIsListening(false);
      };

      try {
        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
      } catch {
        recognitionRef.current = null;
        setIsListening(false);
        toast({
          title: "Could not start dictation",
          description: "Tap the mic again and allow microphone access if asked.",
          variant: "destructive",
        });
      }
    }, [appendTranscript, disabled, readOnly, speechLang, toast]);

    React.useEffect(() => {
      return () => {
        recognitionRef.current?.abort();
      };
    }, []);

    return (
      <div className="relative">
        <BaseTextarea
          ref={setTextareaRef}
          className={cn("pr-12", className)}
          disabled={disabled}
          readOnly={readOnly}
          value={value}
          {...props}
        />
        {speechEnabled ? (
          <Button
            type="button"
            size="icon"
            variant={isListening ? "default" : "secondary"}
            className="absolute right-2 top-2 h-8 w-8 shadow-sm"
            disabled={disabled || readOnly}
            aria-label={isListening ? "Stop speech to text" : "Start speech to text"}
            title={isListening ? "Stop speech to text" : "Start speech to text"}
            onClick={isListening ? stopListening : startListening}
          >
            {isListening ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
        ) : null}
        <span className="sr-only" aria-live="polite">
          {isListening ? "Listening for speech to text." : ""}
        </span>
      </div>
    );
  },
);

SpeechTextarea.displayName = "SpeechTextarea";

export { SpeechTextarea, SpeechTextarea as Textarea };
