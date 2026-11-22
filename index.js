import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";
import usersRouter from "./routes/users.js";
import menuItemsRouter from "./routes/menuItems.js";
import ordersRouter from "./routes/orders.js";
import statsRouter from "./routes/stats.js";
import paymentsRouter from "./routes/payments.js";
import adminRouter from "./routes/admin.js";
import { stripeWebhook } from "./routes/webhook.js";

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Stripe webhook-এ raw body লাগে, তাই এটা express.json() এর আগে থাকতে হবে
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send({ message: "PizzaHub server is running" });
});

app.use("/api/users", usersRouter);
app.use("/api/menu-items", menuItemsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/stats", statsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);

connectDB()
  .then(() => {
    app.listen(port, () => {
      console.log(`PizzaHub server is running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  });