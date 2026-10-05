"use client";

import { Image01 } from "@untitledui/icons";
import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

/** What the caller receives when an image uploads successfully. */
export interface UploadedImage {
  fileId: Id<"files">;
  url: string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const formatMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Image picker with drag-and-drop (PH0-27): validates client-side, uploads
 * via Convex storage (upload URL → POST → `files.saveFile`), and reports the
 * saved file through `onChange`. The caller owns the file's lifecycle — when
 * an image is replaced or cleared, `onChange` fires with the new value and
 * the caller decides what to do with the previous one (attach, detach, or
 * call `files.remove`). It renders nothing about where the image ends up, so
 * catalog, logo, and avatar flows can all reuse it.
 */
export function ImageUpload({
  label,
  hint,
  kind,
  accept = "image/*",
  maxBytes = DEFAULT_MAX_BYTES,
  previewUrl = null,
  onChange,
  disabled = false,
  className,
}: {
  label?: string;
  hint?: string;
  /** `files.kind` to save under — e.g. "avatar", "productImage", "logo". */
  kind: string;
  accept?: string;
  maxBytes?: number;
  /** Current signed URL (re-query as they expire) — shows the preview. */
  previewUrl?: string | null;
  onChange?: (image: UploadedImage | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveFile = useMutation(api.files.saveFile);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownUrl = url ?? previewUrl;

  const pick = async (file: File | undefined | null) => {
    if (file === undefined || file === null || disabled) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file (PNG, JPG, or WEBP).");
      return;
    }
    if (file.size > maxBytes) {
      setError(`That image is ${formatMb(file.size)} — the limit is ${formatMb(maxBytes)}.`);
      return;
    }
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("The upload didn't complete.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const saved = await saveFile({
        storageId,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        kind,
      });
      setUrl(saved.url);
      onChange?.({ fileId: saved.fileId, url: saved.url });
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
      // Allow re-picking the same file name.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clear = () => {
    setError(null);
    setUrl(null);
    onChange?.(null);
  };

  return (
    <div className={cx("space-y-2", className)}>
      {label ? <span className="text-primary block text-sm font-medium">{label}</span> : null}
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void pick(event.dataTransfer.files?.[0]);
        }}
        className={cx(
          "bg-primary ring-secondary flex items-center gap-4 rounded-xl p-3 ring-1",
          disabled && "opacity-60",
        )}
      >
        <div className="bg-secondary ring-secondary flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1">
          {shownUrl ? (
            // Signed URLs are produced by Convex storage for files the user picked.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shownUrl}
              alt={label ?? "Uploaded image"}
              className="size-full object-cover"
            />
          ) : (
            <Image01 className="text-fg-tertiary size-6" />
          )}
        </div>
        <div className="flex min-w-0 flex-col items-start gap-2">
          <div className="flex gap-2">
            <Button
              color="secondary"
              size="sm"
              isDisabled={disabled}
              isLoading={busy}
              onPress={() => inputRef.current?.click()}
            >
              {shownUrl ? "Replace" : "Upload image"}
            </Button>
            {shownUrl && onChange ? (
              <Button color="secondary" size="sm" isDisabled={disabled || busy} onPress={clear}>
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-tertiary text-xs">
            {hint ?? `PNG, JPG, or WEBP — up to ${formatMb(maxBytes)}. Drag & drop works too.`}
          </p>
        </div>
      </div>
      {error ? (
        <p className="text-error text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        aria-label={label ?? "Choose image"}
        onChange={(event) => void pick(event.target.files?.[0])}
      />
    </div>
  );
}
