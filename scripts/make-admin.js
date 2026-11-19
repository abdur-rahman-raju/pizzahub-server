import "dotenv/config";
import { connectDB } from "../db.js";

const email = process.argv[2];

if (!email) {
  console.log("Usage: npm run make-admin -- <email>");
  process.exit(1);
}

try {
  const db = await connectDB();
  const result = await db.collection("users").updateOne(
    { email: email.toLowerCase().trim() },
    { $set: { role: "admin", isBlocked: false, updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) {
    console.log(`No user found with email: ${email}`);
    console.log("First sign up with this email on the website, then run this again.");
  } else {
    console.log(`Done! ${email} is now an admin.`);
  }
} catch (error) {
  console.error("Failed:", error.message);
} finally {
  process.exit(0);
}