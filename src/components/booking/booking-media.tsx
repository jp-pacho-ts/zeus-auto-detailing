"use client";
// /book's split screen: the photo half. It shows what the customer is choosing (the shop, then the service under the
// pointer or the last one picked) with a caption in the landing's display type. A new photo wipes up over the last one,
// as the landing's service panels do, so a change never cuts to black. Its styles are in booking-stage.module.css.
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export type MediaPhoto = { src: string; position?: string; contain?: true };

export function BookingMedia({ photo, title, line }: { photo: MediaPhoto; title: string; line: string }) {
  const [layers, setLayers] = useState([photo]);
  const top = layers[layers.length - 1];
  // Derived during render (React's "adjust state on prop change"): keep the last photo under the new one.
  if (top.src !== photo.src) setLayers([top, photo]);
  return (
    <div data-part="media">
      <div data-part="media-photos" aria-hidden="true">
        {layers.map((p, i) => (
          <div key={p.src} data-part="media-layer">
            <Image src={p.src} alt="" fill priority={i === 0} sizes="(min-width: 1024px) 46vw, 100vw"
              data-contain={p.contain} style={p.position ? { objectPosition: p.position } : undefined} />
          </div>
        ))}
      </div>
      <Link href="/" aria-label="Return to home" data-part="media-home"><Logo /></Link>
      <div data-part="media-caption" aria-hidden="true">
        <p key={title} data-part="media-title"><span>{title}<span data-part="media-dot">.</span></span></p>
        {line && <p key={"l" + line} data-part="media-line">{line}</p>}
      </div>
    </div>
  );
}
