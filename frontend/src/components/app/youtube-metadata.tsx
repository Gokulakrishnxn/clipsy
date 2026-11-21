"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

type Metadata = { title: string; description: string; hashtags: string[] };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 gap-1 px-2 text-xs"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{value}</p>
    </div>
  );
}

/** AI-written YouTube title, description and hashtags for a clip. */
export function YoutubeMetadata({ taskId, clipId }: { taskId: string; clipId: string }) {
  const [data, setData] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (refresh: boolean, signal?: AbortSignal) => {
      setLoading(true);
      setError(false);
      try {
        const response = await fetch(
          `/api/tasks/${taskId}/clips/${clipId}/youtube-metadata${refresh ? "?refresh=true" : ""}`,
          { method: "POST", signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        setData((await response.json()) as Metadata);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [taskId, clipId],
  );

  useEffect(() => {
    setData(null);
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  const hashtags = data?.hashtags.join(" ") ?? "";
  const all = data ? `${data.title}\n\n${data.description}\n\n${hashtags}` : "";

  return (
    <section className="mb-4" aria-label="YouTube details">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-medium text-foreground">YouTube details</h4>
        <div className="flex items-center">
          {data && <CopyButton text={all} label="Copy all YouTube details" />}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            aria-label="Regenerate YouTube details"
            disabled={loading}
            onClick={() => void load(true)}
          >
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
        </div>
      </div>
      <div className="space-y-3 rounded-lg bg-muted p-3">
        {loading && !data && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Writing title, description and hashtags…
          </p>
        )}
        {error && !loading && (
          <p className="text-sm text-muted-foreground">Couldn’t generate YouTube details. Use the refresh button to try again.</p>
        )}
        {data && (
          <>
            <Field label="Title" value={data.title} />
            <Field label="Description" value={data.description} />
            <Field label="Hashtags" value={hashtags} />
          </>
        )}
      </div>
    </section>
  );
}
