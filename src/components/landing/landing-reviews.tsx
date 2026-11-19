import Image from "next/image";
import { LANDING_PHOTOS } from "./landing-photos";

// Example copy for design review. Replace only with customer feedback approved for publication.
const SAMPLE_REVIEWS = [
  { photo: "basic-wash", service: "Wash", quote: "Easy to book, and the car looked spotless when I picked it up." },
  { photo: "exterior-detailing", service: "Detailing", quote: "The cabin felt fresh again, especially the seats and carpets." },
  { photo: "eclipse-graphene", service: "Graphene coating", quote: "They explained the coating options and how to care for the finish." },
  { photo: "signature-wash", service: "Signature wash", quote: "I appreciated the care around the wheels and door edges." },
] as const;

function SampleReviews() {
  return SAMPLE_REVIEWS.map(({ photo, service, quote }) => {
    const image = LANDING_PHOTOS[photo];
    return (
      <figure className="landing-review-frame" key={photo}>
        <Image
          src={image.src}
          alt={image.alt}
          width={1600}
          height={1200}
          sizes="(max-width: 767px) 79vw, (max-width: 1120px) 280px, 25vw"
          style={{ objectPosition: image.position }}
        />
        <figcaption>
          <span className="landing-review-sample">Sample review</span>
          <div className="landing-review-copy">
            <p>&ldquo;{quote}&rdquo;</p>
            <span>{service}</span>
          </div>
        </figcaption>
      </figure>
    );
  });
}

export function LandingReviews() {
  return (
    <section id="reviews" className="landing-section landing-reviews" aria-labelledby="landing-reviews-title">
      <div className="landing-wrap landing-review-head">
        <h2 id="landing-reviews-title">Customer experiences<span className="landing-gold-dot">.</span></h2>
        <p>Sample reviews for this preview. Customer feedback will appear here.</p>
      </div>
      <div className="landing-review-window" role="group" tabIndex={0} aria-label="Sample reviews. Focus or hover to pause the strip.">
        <div className="landing-review-track">
          <div className="landing-review-group"><SampleReviews /></div>
          <div className="landing-review-group" aria-hidden="true" inert><SampleReviews /></div>
        </div>
      </div>
    </section>
  );
}
