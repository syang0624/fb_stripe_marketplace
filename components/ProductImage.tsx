"use client";

import { useState } from "react";

interface ProductImageProps {
  src?: string;
  alt: string;
  // Applied to both the <img> and the fallback box, so the parent controls size.
  className?: string;
  fallbackLabel?: string;
}

// Marketplace photos are Facebook CDN URLs. Two things make them flaky:
//   1. fbcdn applies referrer-based hotlink protection — `no-referrer` avoids it.
//   2. Signed URLs expire / can 403 — `onError` swaps in a graceful placeholder
//      instead of a broken-image icon.
export function ProductImage({ src, alt, className = "", fallbackLabel = "No image" }: ProductImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center bg-mist text-[10px] text-ink/30 ${className}`}>
        {fallbackLabel}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
