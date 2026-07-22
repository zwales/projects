import express from "express";
import Stripe from "stripe";
import { config } from "../config.js";
import { Users, Events } from "../lib/db.js";
import { auth } from "../middleware/auth.js";

const stripe = config.stripe.secret ? new Stripe(config.stripe.secret) : null;
const PRICES = { pro: config.stripe.pricePro, team: config.stripe.priceTeam };
export const billingEnabled = !!stripe;

// Raw-body webhook (mounted before express.json in index.js).
export async function webhookHandler(req, res) {
  if (!stripe || !config.stripe.webhookSecret) return res.status(503).end();
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], config.stripe.webhookSecret); }
  catch (err) { return res.status(400).send(`Webhook signature failed: ${err.message}`); }
  if (await Events.seen.get(event.id)) return res.json({ received: true, duplicate: true });
  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const plan = s.metadata?.plan === "team" ? "team" : "pro";
      if (s.client_reference_id) {
        await Users.setCustomer.run(s.customer, Number(s.client_reference_id));
        await Users.setPlan.run(plan, Number(s.client_reference_id));
      }
    } else if (event.type === "customer.subscription.deleted") {
      await Users.setPlanByCustomer.run("free", event.data.object.customer);
    }
    await Events.mark.run(event.id);
  } catch (e) { console.error("webhook handler error", e); return res.status(500).end(); }
  res.json({ received: true });
}

export function billingRoutes() {
  const r = express.Router();
  r.post("/checkout", auth, async (req, res) => {
    if (!stripe) return res.status(503).json({ error: "Billing isn't configured yet." });
    const plan = req.body.plan === "team" ? "team" : "pro";
    const price = PRICES[plan];
    if (!price) return res.status(503).json({ error: `No Stripe price set for ${plan}.` });
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription", line_items: [{ price, quantity: 1 }],
        client_reference_id: String(req.user.id), customer_email: req.user.email, metadata: { plan },
        success_url: `${config.appUrl}/app?upgraded=1`, cancel_url: `${config.appUrl}/app?canceled=1`,
      });
      res.json({ url: session.url });
    } catch (e) { console.error("checkout error", e); res.status(500).json({ error: "Could not start checkout." }); }
  });
  return r;
}
