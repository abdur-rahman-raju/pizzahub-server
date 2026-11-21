
import express from "express";
import cors from "cors";
import "dotenv/config";

import { connectDB } from "./db.js";
import { verifyJWT } from "./auth.js";
import usersRouter from "./routes/users.js";
import menuItemsRouter from "./routes/menuItems.js";
import ordersRouter from "./routes/orders.js";
import statsRouter from "./routes/stats.js";


const app = express();
const port = process.env.PORT || 5000;


app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use("/api/menu-items", menuItemsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/stats", statsRouter);

app.use(express.json());


app.get("/", (req, res) => {
  res.send({ message: "PizzaHub server is running" });
});


app.get("/api/me", verifyJWT, (req, res) => {
  res.send(req.user);
});

app.use("/api/users", usersRouter);

connectDB()
  .then(() => {
    app.listen(port, () => {
      console.log(`PizzaHub server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
