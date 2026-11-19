import express from "express";
import cors from "cors";
import "dotenv/config";
import { connectDB } from "./db.js";
import { verifyJWT, verifyRole } from "./auth.js";

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.send({ message: "PizzaHub server is running" });
});


app.get("/api/me", verifyJWT, (req, res) => {
  res.send(req.user);
});


app.get("/api/admin-check", verifyJWT, verifyRole("admin"), (req, res) => {
  res.send({ message: "Hello admin" });
});

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

