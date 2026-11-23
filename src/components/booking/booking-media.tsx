"use client";
// /book's split screen: the photo half. It answers every choice, the way car configurators and hotel booking pages do:
// step 1 is a dark studio with the chosen (or hovered) size's gold outline under a spotlight; step 2 shows the service
// under the pointer or the last one picked; step 3 sets the chosen day very large; step 4 lists the build like a
// receipt with its total. A gold-edged curtain crosses the photo at each step, and a new photo wipes up over the last
// one, as the landing's service panels do. Its styles are in booking-stage.module.css.
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { VehicleDrawing } from "@/components/booking/vehicle-drawing";

export type MediaPhoto = { src: string; position?: string; contain?: true };
export type MediaScene = {
  photo: MediaPhoto;
  title: string;
  line: string;
  vehicle?: string | null;
  date?: { weekday: string; day: string; month: string } | null;
  receipt?: { items: { name: string; amount: string }[]; total: string } | null;
};

const SCENES = ["garage", "photo", "date", "build"];

export function BookingMedia({ step, scene }: { step: number; scene: MediaScene }) {
  const { photo, title, line, vehicle, date, receipt } = scene;
  const [layers, setLayers] = useState([photo]);
  const top = layers[layers.length - 1];
  // Derived during render (React's "adjust state on prop change"): keep the last photo under the new one.
  if (top.src !== photo.src) setLayers([top, photo]);
  return (
    <div data-part="media" data-scene={SCENES[step - 1]}>
      <div data-part="media-photos" aria-hidden="true">
        {layers.map((p, i) => (
          <div key={p.src} data-part="media-layer">
            <Image src={p.src} alt="" fill priority={i === 0} sizes="(min-width: 1024px) 46vw, 100vw"
              data-contain={p.contain} style={p.position ? { objectPosition: p.position } : undefined} />
          </div>
        ))}
      </div>
      {step === 1 && vehicle && (
        <div data-part="media-garage" aria-hidden="true">
          <div key={vehicle} data-part="media-car"><VehicleDrawing code={vehicle} /></div>
        </div>
      )}
      <div key={step} data-part="media-curtain" aria-hidden="true" />
      <Link href="/" aria-label="Return to home" data-part="media-home"><Logo /></Link>
      <div data-part="media-caption" aria-hidden="true">
        {date ? (
          <p key={date.weekday + date.day + date.month} data-part="media-date">
            <span>{date.weekday}</span>
            <span>{date.day}</span>
            <span>{date.month}<span data-part="media-dot">.</span></span>
          </p>
        ) : (
          <p key={title} data-part="media-title"><span>{title}<span data-part="media-dot">.</span></span></p>
        )}
        {line && <p key={"l" + line} data-part="media-line">{line}</p>}
        {receipt && receipt.items.length > 0 && (
          <div data-part="media-receipt">
            <ul>
              {receipt.items.map((item) => (
                <li key={item.name}><span>{item.name}</span><span>{item.amount}</span></li>
              ))}
            </ul>
            {receipt.total && <p><span>Total</span><strong data-count="">{receipt.total}</strong></p>}
          </div>
        )}
      </div>
    </div>
  );
}
