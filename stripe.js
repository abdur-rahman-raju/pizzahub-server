import "dotenv/config";
import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("STRIPE_SECRET_KEY is not set. Payments will not work.");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");


export const PREMIUM_PRICE_CENTS = 999;
export const PREMIUM_DAYS = 30;