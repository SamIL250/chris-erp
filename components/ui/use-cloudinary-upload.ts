"use client";

import { useAction, useMutation } from "convex/react";
import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/** What an upload produced: the registry row + its permanent delivery URL. */
export interface UploadedImage {
  fileId: Id<"files">;
  url: string;
}

/**
 * The Cloudinary signed-direct-upload flow (PH1-13), shared by every image
 * picker: ask Convex for a signature (`files:generateCloudinarySignature`),
 * POST the bytes straight to Cloudinary (no proxy through our servers),
 * register the returned URL + public id (`files.saveCloudinary`). The API
 * secret never reaches the browser — only the signature does.
 *
 * The caller validates type/size first and owns the resulting row: attach
 * it, or call `files.remove`.
 */
export function useCloudinaryUpload() {
  const generateSignature = useAction(api.files.generateCloudinarySignature);
  const saveCloudinary = useMutation(api.files.saveCloudinary);

  return useCallback(
    async (file: File, kind: string): Promise<UploadedImage> => {
      const signature = await generateSignature({});
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", signature.apiKey);
      form.append("timestamp", String(signature.timestamp));
      form.append("signature", signature.signature);
      form.append("folder", signature.folder);
      const res = await fetch(signature.uploadUrl, { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "The upload didn't complete.");
      }
      const asset = (await res.json()) as { secure_url: string; public_id: string };
      const saved = await saveCloudinary({
        url: asset.secure_url,
        publicId: asset.public_id,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        kind,
      });
      return { fileId: saved.fileId, url: saved.url };
    },
    [generateSignature, saveCloudinary],
  );
}
