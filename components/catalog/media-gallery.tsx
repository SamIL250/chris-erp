"use client";

import { ArrowDown, ArrowUp, Image01, Plus, Trash01 } from "@untitledui/icons";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { MAX_IMAGE_ALT } from "@/lib/images";
import { useCloudinaryUpload } from "@/components/ui/use-cloudinary-upload";

/** One entry of the cover-first `images[]` list (the schema's exact shape). */
export type GalleryImage = { fileId: Id<"files">; alt?: string };

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const formatMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Product Media gallery (PH1-13): upload (signed direct to Cloudinary),
 * cover-first reorder, per-image alt text, remove. Array order IS the
 * display order — index 0 is the cover, badged in place.
 *
 * The form owns the list: `onChange` delivers the next full list
 * (upload / reorder / alt) so it can mark the form dirty; `onRemove` lets
 * the form defer deletion until a save excludes the file (deleting earlier
 * could strand a reference if that save then failed).
 *
 * Previews come from one batched `files.urls` query that re-runs as the
 * list changes — freshly uploaded files appear as soon as they register.
 */
export function MediaGallery({
  images,
  onChange,
  onRemove,
  disabled = false,
}: {
  images: GalleryImage[];
  onChange: (next: GalleryImage[]) => void;
  onRemove: (fileId: Id<"files">) => void;
  disabled?: boolean;
}) {
  const upload = useCloudinaryUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  // Uploads await — reorder/alt edits made mid-flight must not be
  // clobbered, so append to the LATEST list, not this render's closure.
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileIds = useMemo(() => images.map((image) => image.fileId), [images]);
  const urlRows = useQuery(api.files.urls, { fileIds });
  const urlFor = (fileId: Id<"files">) =>
    urlRows?.find((row) => row.fileId === fileId)?.url ?? null;

  const pick = async (file: File | undefined | null) => {
    if (file === undefined || file === null || disabled || busy) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file (PNG, JPG, or WEBP).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${formatMb(file.size)} — the limit is ${formatMb(MAX_BYTES)}.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await upload(file, "productImage");
      onChange([...imagesRef.current, { fileId: saved.fileId }]);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
      // Allow re-picking the same file name.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const move = (index: number, to: number) => {
    const next = [...images];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const setAlt = (fileId: Id<"files">, alt: string) =>
    onChange(images.map((image) => (image.fileId === fileId ? { ...image, alt } : image)));

  const controlsDisabled = disabled || busy;

  return (
    <div className="space-y-4">
      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {images.map((image, index) => {
            const url = urlFor(image.fileId);
            return (
              <li
                key={image.fileId}
                className="bg-primary ring-secondary overflow-hidden rounded-xl ring-1"
              >
                <div className="bg-secondary relative aspect-square w-full overflow-hidden">
                  {url ? (
                    // Cloudinary delivery URL for the picked file.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={image.alt ?? ""} className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <Image01 className="text-fg-tertiary size-8" />
                    </div>
                  )}
                  {index === 0 ? (
                    <span className="bg-primary ring-tertiary text-secondary absolute top-2 left-2 rounded-full px-2 py-0.5 text-xs font-medium shadow-xs ring-1">
                      Cover
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2 p-3">
                  <Input
                    size="sm"
                    placeholder="Alt text (describe for screen readers)"
                    value={image.alt ?? ""}
                    onChange={(value) => setAlt(image.fileId, value)}
                    maxLength={MAX_IMAGE_ALT}
                    isDisabled={controlsDisabled}
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      color="secondary"
                      aria-label="Move image up"
                      iconLeading={ArrowUp}
                      isDisabled={controlsDisabled || index === 0}
                      onPress={() => move(index, index - 1)}
                    />
                    <Button
                      size="sm"
                      color="secondary"
                      aria-label="Move image down"
                      iconLeading={ArrowDown}
                      isDisabled={controlsDisabled || index === images.length - 1}
                      onPress={() => move(index, index + 1)}
                    />
                    <Button
                      size="sm"
                      color="secondary"
                      isDisabled={controlsDisabled || index === 0}
                      onPress={() => move(index, 0)}
                    >
                      Make cover
                    </Button>
                    <Button
                      size="sm"
                      color="tertiary-destructive"
                      iconLeading={Trash01}
                      isDisabled={controlsDisabled}
                      onPress={() => onRemove(image.fileId)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void pick(event.dataTransfer.files?.[0]);
        }}
        className="bg-primary ring-secondary flex flex-wrap items-center justify-between gap-3 rounded-xl p-4 ring-1"
      >
        <div className="flex items-center gap-3">
          <div className="bg-secondary ring-secondary flex size-10 shrink-0 items-center justify-center rounded-lg ring-1">
            <Image01 className="text-fg-tertiary size-5" />
          </div>
          <div>
            <p className="text-secondary text-sm font-medium">
              {images.length === 0
                ? "No images yet."
                : `${images.length} image${images.length === 1 ? "" : "s"} attached.`}
            </p>
            <p className="text-tertiary text-xs">
              The first image is the cover — move images to reorder.
            </p>
          </div>
        </div>
        <Button
          color="secondary"
          size="sm"
          iconLeading={Plus}
          isLoading={busy}
          isDisabled={disabled}
          onPress={() => inputRef.current?.click()}
        >
          {images.length === 0 ? "Upload image" : "Add image"}
        </Button>
      </div>

      <p className="text-tertiary text-xs">
        PNG, JPG, or WEBP — up to {formatMb(MAX_BYTES)}. Drag &amp; drop works too. Alt text: max{" "}
        {MAX_IMAGE_ALT} characters; leave blank for decorative images.
      </p>
      {error ? (
        <p className="text-error text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Add product image"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
    </div>
  );
}
