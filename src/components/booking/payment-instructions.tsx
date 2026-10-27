import Image from "next/image";
import { brandConfig } from "@/config/brand";

// P1-18: how to pay an optional deposit to the shop's own accounts (brand.ts). The system never
// computes an amount or takes a payment; the shop tells the customer what to pay.
// P1-19 W12: only if the shop asks; the reference goes in the payment note so the shop can match it.
export function PaymentInstructions({ where = "confirmation", referenceCode }: { where?: "confirmation" | "manage"; referenceCode: string }) {
  return (
    <section aria-labelledby="payment-title" className="rounded border border-border bg-card p-4 sm:p-8">
      <h2 id="payment-title" className="text-lg font-bold text-foreground">Paying a deposit</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Pay a deposit only if the shop asks you to; wait for its message with the amount. Then pay to one of these accounts and
        put <strong className="font-semibold text-foreground">{referenceCode}</strong> in the GCash or bank note. Sending a
        screenshot is optional: {where === "manage" ? "send it below" : "send it from your booking page"}, or pay at the shop
        instead.
      </p>
      <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {brandConfig.payment.accounts.map((a) => (
          <li key={a.provider} className="rounded border border-border bg-[#121214] p-4">
            <p className="font-bold text-foreground">{a.provider}</p>
            <dl className="mt-2 space-y-1 text-sm">
              <div>
                <dt className="inline text-muted-foreground">Account name: </dt>
                <dd className="inline font-semibold text-foreground">{a.accountName}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">{a.numberLabel}: </dt>
                <dd className="inline select-all font-semibold tabular-nums text-foreground">{a.number}</dd>
              </div>
            </dl>
            {/* Served as-is: the optimizer must not re-encode a QR code. A white margin lets scanners find it. */}
            <div className="mt-4 w-fit rounded bg-white p-3">
              <Image
                src={a.qrImage}
                alt={`${a.provider} QR code for ${a.accountName}`}
                width={600}
                height={600}
                unoptimized
                className="h-44 w-44"
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
