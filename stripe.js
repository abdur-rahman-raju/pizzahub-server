import "dotenv/config";
import Stripe from "stripe";

let client;

// Stripe প্রথমবার দরকার হলে তখনই তৈরি হয়। key না থাকলে শুধু পেমেন্টের রিকোয়েস্ট ব্যর্থ হয়, বাকি সার্ভার চলে
export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}

// Premium প্ল্যান: $9.99 এ ৩০ দিন
export const PREMIUM_PRICE_CENTS = 999;
export const PREMIUM_DAYS = 30;