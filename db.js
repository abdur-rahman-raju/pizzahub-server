import { MongoClient, ServerApiVersion } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;

export async function connectDB() {
  if (db) return db;
  await client.connect();
  db = client.db(process.env.DB_NAME);
  await db.command({ ping: 1 });
  console.log("MongoDB connected");
  return db;
}

export function getDB() {
  if (!db) throw new Error("Database not connected yet");
  return db;
}