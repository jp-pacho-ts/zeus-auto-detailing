import Image from "next/image";
import { LANDING_PHOTOS } from "./landing-photos";

const WORKSHOP_FRAMES = [
  { photo: "basic-wash", caption: "Drying by hand" },
  { photo: "exterior-detailing", caption: "Machine polishing" },
  { photo: "eclipse-graphene", caption: "Graphene application" },
  { photo: "signature-wash", caption: "The final wipe" },
] as const;

function WorkshopFrames() {
  return WORKSHOP_FRAMES.map(({ photo, caption }) => {
    const image = LANDING_PHOTOS[photo];
    return (
      <figure className="landing-review-frame" key={photo}>
        <Image
          src={image.src}
          alt={image.alt}
          width={1600}
          height={1200}
          sizes="(max-width: 767px) 72vw, (max-width: 1040px) 260px, 25vw"
          style={{ objectPosition: image.position }}
        />
        <figcaption>{caption}</figcaption>
      </figure>
    );
  });
}

export function LandingReviews() {
  return (
    <section id="reviews" className="landing-section landing-reviews" aria-labelledby="landing-reviews-title">
      <div className="landing-wrap landing-review-head">
        <h2 id="landing-reviews-title">Customer experiences<span className="landing-gold-dot">.</span></h2>
        <p>Customer feedback will appear here.</p>
      </div>
      <div className="landing-review-window" role="group" tabIndex={0} aria-label="Workshop photos. Focus or hover to pause the strip.">
        <div className="landing-review-track">
          <div className="landing-review-group"><WorkshopFrames /></div>
          <div className="landing-review-group" aria-hidden="true" inert><WorkshopFrames /></div>
        </div>
      </div>
    </section>
  );
}
