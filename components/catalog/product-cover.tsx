import { Image01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";

/** The product's cover, or a placeholder when it has no image. */
export function ProductCover({
  src,
  className,
}: {
  src: string | null | undefined;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "bg-secondary ring-secondary relative size-10 shrink-0 overflow-hidden rounded-lg ring-1",
        className,
      )}
    >
      {src ? (
        // Cover delivery URL. The product name beside it is the accessible name.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Image01 className="text-fg-tertiary size-4" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/** Cover plus the product name and a second line (usually the SKU). */
export function ProductIdentity({
  name,
  meta,
  src,
}: {
  name: string;
  meta?: string;
  src: string | null | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ProductCover src={src} />
      <div className="min-w-0">
        <p className="text-primary truncate text-sm font-medium">{name}</p>
        {meta ? <p className="text-tertiary truncate text-xs">{meta}</p> : null}
      </div>
    </div>
  );
}
