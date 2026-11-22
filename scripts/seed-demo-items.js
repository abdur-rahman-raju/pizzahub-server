import "dotenv/config";
import { connectDB } from "../db.js";

const email = process.argv[2];
const remove = process.argv[3] === "--remove";

if (!email) {
  console.log("Usage: npm run seed:demo -- <vendor-email> [--remove]");
  process.exit(1);
}

const img = (id) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=800&q=80`;

const demoItems = [
  { itemName: "Margherita Classica", category: "Classic Pizzas", description: "Tomato sauce, fresh mozzarella and basil on a thin crust.", price: 9.99, location: "Dhanmondi, Dhaka", photo: "1513104890138-7c749659a591" },
  { itemName: "Pepperoni Feast", category: "Classic Pizzas", description: "Double pepperoni with melted mozzarella and tomato sauce.", price: 12.99, location: "Gulshan, Dhaka", photo: "1604382354936-07c5d9983bd3" },
  { itemName: "Garden Veggie Delight", category: "Vegetarian Pizzas", description: "Bell peppers, olives, onions and mushrooms with cheese.", price: 11.49, location: "Banani, Dhaka", photo: "1565299624946-b28f40a0ae38" },
  { itemName: "Mushroom & Spinach", category: "Vegetarian Pizzas", description: "Sauteed mushrooms and spinach with garlic cream sauce.", price: 11.99, location: "Uttara, Dhaka", photo: "1574071318508-1cdbab80d002" },
  { itemName: "BBQ Chicken Supreme", category: "Meat Lovers", description: "Grilled chicken, BBQ sauce, red onion and smoked cheese.", price: 14.49, location: "Mirpur, Dhaka", photo: "1593560708920-61dd98c46a4e" },
  { itemName: "Meat Lovers Overload", category: "Meat Lovers", description: "Beef, chicken, sausage and pepperoni on a cheesy base.", price: 15.99, location: "Gazipur, Dhaka", photo: "1594007654729-407eedc4be65" },
  { itemName: "Truffle Four Cheese", category: "Specialty / Gourmet Pizzas", description: "Mozzarella, cheddar, parmesan and blue cheese with truffle oil.", price: 17.99, location: "Gulshan, Dhaka", photo: "1571407970349-bc81e7e96d47" },
  { itemName: "Spicy Sausage Special", category: "Specialty / Gourmet Pizzas", description: "Hot sausage, jalapenos and a drizzle of chili honey.", price: 16.49, location: "Dhanmondi, Dhaka", photo: "1513104890138-7c749659a591" },
];

try {
  const db = await connectDB();
  const vendor = await db
    .collection("users")
    .findOne({ email: email.toLowerCase().trim() });

  if (!vendor || vendor.role !== "vendor") {
    console.log("No vendor account found with this email.");
  } else if (remove) {
    const result = await db
      .collection("menuItems")
      .deleteMany({ vendorId: vendor._id, isDemo: true });
    console.log(`Removed ${result.deletedCount} demo items.`);
  } else {
    const already = await db
      .collection("menuItems")
      .countDocuments({ vendorId: vendor._id, isDemo: true });

    if (already > 0) {
      console.log("Demo items already exist for this vendor.");
    } else {
      const now = Date.now();
      const docs = demoItems.map((item, index) => ({
        vendorId: vendor._id,
        itemName: item.itemName,
        category: item.category,
        description: item.description,
        price: item.price,
        location: item.location,
        images: [img(item.photo)],
        status: "approved",
        isDemo: true,
        createdAt: new Date(now - index * 60000),
      }));
      await db.collection("menuItems").insertMany(docs);
      console.log(`Added ${docs.length} demo items.`);
    }
  }
} catch (error) {
  console.error("Failed:", error.message);
} finally {
  process.exit(0);
}