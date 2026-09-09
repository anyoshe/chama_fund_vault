/**
 * Payment rails abstraction for ChamaVault.
 *
 * Modes:
 * - recorded: treasurer/member records payment (pilot / until Daraja is live)
 * - live: call backend that talks to Safaricom Daraja (STK Push)
 *
 * Set VITE_PAYMENT_MODE=live and VITE_PAYMENTS_API_URL when Edge Function is deployed.
 */

export type PaymentIntent = {
  kind: "contribution" | "repayment";
  chamaId: string;
  amount: number;
  phone?: string;
  reference?: string;
  method: string;
};

export type PaymentResult = {
  ok: boolean;
  mode: "recorded" | "live";
  reference: string;
  message: string;
  providerRef?: string;
};

const mode = (import.meta.env.VITE_PAYMENT_MODE as string) || "recorded";
const apiUrl = (import.meta.env.VITE_PAYMENTS_API_URL as string) || "";

export function paymentMode(): "recorded" | "live" {
  return mode === "live" ? "live" : "recorded";
}

export async function initiatePayment(intent: PaymentIntent): Promise<PaymentResult> {
  const reference =
    intent.reference ||
    `CV-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9999)}`;

  if (paymentMode() === "live" && apiUrl) {
    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, "")}/stk-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          mode: "live",
          reference,
          message: body.message || "STK push failed",
        };
      }
      return {
        ok: true,
        mode: "live",
        reference: body.reference || reference,
        providerRef: body.CheckoutRequestID || body.providerRef,
        message: body.message || "STK push sent — enter PIN on your phone",
      };
    } catch (e) {
      return {
        ok: false,
        mode: "live",
        reference,
        message: e instanceof Error ? e.message : "Payment service unreachable",
      };
    }
  }

  // Pilot path: record only (no money movement API)
  return {
    ok: true,
    mode: "recorded",
    reference,
    message:
      "Payment recorded for the group books. Connect Safaricom Daraja (VITE_PAYMENT_MODE=live) for real STK.",
  };
}
