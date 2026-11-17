import { MessageSquareQuote } from "lucide-react";

// No approved quotes yet: repeated visual slots are explicitly labelled, never social proof.
function ReviewSlots() {
  return <>{["The everyday refresh", "A finish worth caring for", "The next chapter"].map((title) =>
    <article className="landing-review-card" key={title}>
      <div className="landing-review-card-top"><MessageSquareQuote aria-hidden="true" /><span>Preview slot</span></div>
      <span className="landing-review-pending">Review awaiting owner approval</span>
      <h3>{title}</h3><p>Customer feedback will appear here.</p>
    </article>)}</>;
}

export function LandingReviews() {
  return <section id="reviews" className="landing-section landing-reviews" aria-labelledby="landing-reviews-title">
    <div className="landing-wrap landing-review-head"><h2 id="landing-reviews-title">Customer experiences.</h2><p>Space for the stories behind the cars.<br />Approved customer feedback will appear here.</p></div>
    <div className="landing-review-window" tabIndex={0} aria-label="Preview feedback slots. Focus or hover to stop scrolling. No published reviews yet.">
      <div className="landing-review-track">
        <div className="landing-review-group"><ReviewSlots /></div>
        <div className="landing-review-group" aria-hidden="true" inert><ReviewSlots /></div>
      </div>
    </div>
    <p className="landing-wrap landing-review-disclaimer">Preview content slots. No ratings or customer testimonials are claimed.</p>
  </section>;
}
