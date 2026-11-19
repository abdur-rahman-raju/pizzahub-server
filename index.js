import express from "express";
import cors from "cors";
import "dotenv/config";

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

app.listen(port, () => {
  console.log(`PizzaHub server running on port ${port}`);
});