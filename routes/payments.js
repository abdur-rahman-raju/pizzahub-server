import express from "express";
import { verifyJWT, verifyRole } from "../auth.js";
import { stripe, PREMIUM_PRICE_CENTS, PREMIUM_DAYS } from "../stripe.js";

const router = express.Router();

router.post("/checkout", verifyJWT, verifyRole("vendor"), async (req, res) => {
  try {
    if (req.user.subscriptionPlan === "premium") {
      return res.status(400).send({ message: "You already have an active Premium plan" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: PREMIUM_PRICE_CENTS,
            product_data: {
              name: `PizzaHub Premium (${PREMIUM_DAYS} days)`,
              description: "Unlimited menu items for your shop",
            },
          },
        },
      ],
      customer_email: req.user.email,
      client_reference_id: req.user.id,
      metadata: { vendorId: req.user.id, plan: "premium" },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
    });

    res.send({ url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to start checkout" });
  }
});

export default router;