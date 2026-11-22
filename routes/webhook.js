import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { getStripe, PREMIUM_DAYS } from "../stripe.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function activatePremium(session) {
  const vendorId = session.metadata?.vendorId;
  if (!vendorId || !ObjectId.isValid(vendorId)) return; // আমাদের session নয়

  const db = getDB();
  const transactions = db.collection("transactions");

  // একই session দ্বিতীয়বার এলে কিছু করব না (Stripe একই event আবার পাঠাতে পারে)
  const saved = await transactions.updateOne(
    { sessionId: session.id },
    {
      $setOnInsert: {
        sessionId: session.id,
        paymentIntentId: session.payment_intent || null,
        vendorId: new ObjectId(vendorId),
        email: session.customer_details?.email || session.customer_email || null,
        amount: (session.amount_total ?? 0) / 100,
        currency: session.currency,
        plan: "premium",
        status: "paid",
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  if (saved.upsertedCount === 0) return;

  try {
    const users = db.collection("users");
    const user = await users.findOne({ _id: new ObjectId(vendorId) });
    if (!user) throw new Error("Vendor not found");

    // আগের মেয়াদ বাকি থাকলে তার ওপর ৩০ দিন যোগ হবে
    const current = user.subscriptionExpiresAt
      ? new Date(user.subscriptionExpiresAt).getTime()
      : 0;
    const base = Math.max(Date.now(), current);

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          subscriptionPlan: "premium",
          subscriptionExpiresAt: new Date(base + PREMIUM_DAYS * DAY_MS),
        },
      }
    );
  } catch (error) {
    // ব্যর্থ হলে transaction মুছে দিই, যাতে Stripe-এর retry আবার চেষ্টা করতে পারে
    await transactions.deleteOne({ sessionId: session.id });
    throw error;
  }
}

export async function stripeWebhook(req, res) {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body, // raw Buffer
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error("Webhook signature check failed:", error.message);
    return res.status(400).send("Invalid signature");
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        await activatePremium(session);
      }
    }
    res.send({ received: true });
  } catch (error) {
    console.error("Webhook handling failed:", error);
    res.status(500).send("Webhook handler failed");
  }
}