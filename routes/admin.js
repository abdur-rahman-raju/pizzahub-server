import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { verifyJWT, verifyRole } from "../auth.js";

const router = express.Router();

// এই ফাইলের সব রাউট শুধু অ্যাডমিনের জন্য
router.use(verifyJWT, verifyRole("admin"));

const isValidId = (id) => typeof id === "string" && ObjectId.isValid(id) && String(new ObjectId(id)) === id;

const userFields = {
  name: 1,
  email: 1,
  image: 1,
  role: 1,
  isBlocked: 1,
  businessName: 1,
  subscriptionPlan: 1,
  subscriptionExpiresAt: 1,
  createdAt: 1,
};

function toCounts(rows, keys) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const row of rows) {
    if (row._id in counts) counts[row._id] = row.count;
  }
  return counts;
}
const countBy = (field) => [{ $group: { _id: `$${field}`, count: { $sum: 1 } } }];

// ---------- ড্যাশবোর্ড পরিসংখ্যান ----------
// GET /api/admin/stats
router.get("/stats", async (req, res) => {
  try {
    const db = getDB();
    const [userRows, itemRows, orderRows, revenueRows] = await Promise.all([
      db.collection("users").aggregate(countBy("role")).toArray(),
      db.collection("menuItems").aggregate(countBy("status")).toArray(),
      db.collection("orders").aggregate(countBy("status")).toArray(),
      db
        .collection("transactions")
        .aggregate([{ $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }])
        .toArray(),
    ]);

    const users = toCounts(userRows, ["customer", "vendor", "admin"]);
    const items = toCounts(itemRows, ["pending", "approved", "rejected", "inactive"]);
    const orders = toCounts(orderRows, ["pending", "accepted", "rejected", "cancelled"]);

    res.send({
      users,
      totalUsers: Object.values(users).reduce((a, b) => a + b, 0),
      items,
      totalItems: Object.values(items).reduce((a, b) => a + b, 0),
      orders,
      totalOrders: Object.values(orders).reduce((a, b) => a + b, 0),
      revenue: revenueRows[0]?.total ?? 0,
      totalTransactions: revenueRows[0]?.count ?? 0,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load admin stats" });
  }
});

// ---------- ইউজার তালিকা ----------
// GET /api/admin/users?role=vendor
router.get("/users", async (req, res) => {
  try {
    const filter = {};
    const { role } = req.query;
    if (role !== undefined && role !== "") {
      if (!["customer", "vendor", "admin"].includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
      }
      filter.role = role;
    }

    const users = await getDB()
      .collection("users")
      .find(filter, { projection: userFields })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    res.send(users);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load users" });
  }
});

// ---------- ইউজার block / unblock ----------
// PATCH /api/admin/users/:id/block   body: { isBlocked: true | false }
router.patch("/users/:id/block", async (req, res) => {
  try {
    const { id } = req.params;
    const { isBlocked } = req.body;

    if (!isValidId(id)) {
      return res.status(400).send({ message: "Invalid user ID" });
    }
    if (typeof isBlocked !== "boolean") {
      return res.status(400).send({ message: "isBlocked must be true or false" });
    }

    const users = getDB().collection("users");
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }
    if (user.role === "admin") {
      return res.status(403).send({ message: "Admin accounts cannot be blocked" });
    }

    await users.updateOne({ _id: user._id }, { $set: { isBlocked } });
    res.send({ message: isBlocked ? "User blocked" : "User unblocked", isBlocked });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to update user" });
  }
});

// ---------- সব মেনু আইটেম ----------
// GET /api/admin/menu-items?status=pending
router.get("/menu-items", async (req, res) => {
  try {
    const match = {};
    const { status } = req.query;
    if (status !== undefined && status !== "") {
      if (!["pending", "approved", "rejected", "inactive"].includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }
      match.status = status;
    }

    const items = await getDB()
      .collection("menuItems")
      .aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        { $limit: 500 },
        {
          $lookup: {
            from: "users",
            localField: "vendorId",
            foreignField: "_id",
            as: "vendor",
          },
        },
        { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            itemName: 1,
            category: 1,
            price: 1,
            location: 1,
            images: 1,
            status: 1,
            inactiveBy: 1,
            createdAt: 1,
            vendor: {
              _id: "$vendor._id",
              name: "$vendor.name",
              email: "$vendor.email",
              businessName: "$vendor.businessName",
            },
          },
        },
      ])
      .toArray();

    res.send(items);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load menu items" });
  }
});

// ---------- আইটেমের স্ট্যাটাস বদল ----------
// PATCH /api/admin/menu-items/:id/status   body: { status }
//   pending  -> approved | rejected
//   approved -> inactive
//   inactive (অ্যাডমিনের করা) -> approved
router.patch("/menu-items/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).send({ message: "Invalid item ID" });
    }
    if (!["approved", "rejected", "inactive"].includes(status)) {
      return res.status(400).send({ message: "Status must be approved, rejected or inactive" });
    }

    const menuItems = getDB().collection("menuItems");
    const item = await menuItems.findOne({ _id: new ObjectId(id) });
    if (!item) {
      return res.status(404).send({ message: "Menu item not found" });
    }

    const allowed =
      (item.status === "pending" && (status === "approved" || status === "rejected")) ||
      (item.status === "approved" && status === "inactive") ||
      (item.status === "inactive" && item.inactiveBy === "admin" && status === "approved");

    if (!allowed) {
      return res.status(400).send({
        message: `Cannot change an item from ${item.status} to ${status}`,
      });
    }

    const update = { $set: { status, updatedAt: new Date() } };
    if (status === "inactive") {
      update.$set.inactiveBy = "admin";
    } else {
      update.$unset = { inactiveBy: "" };
    }

    await menuItems.updateOne({ _id: item._id }, update);
    res.send({ message: `Item ${status}`, status });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to update item status" });
  }
});

// ---------- আইটেম ডিলিট ----------
// DELETE /api/admin/menu-items/:id
router.delete("/menu-items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).send({ message: "Invalid item ID" });
    }

    const db = getDB();
    const item = await db.collection("menuItems").findOne({ _id: new ObjectId(id) });
    if (!item) {
      return res.status(404).send({ message: "Menu item not found" });
    }

    const activeOrders = await db.collection("orders").countDocuments({
      itemId: item._id,
      status: { $in: ["pending", "accepted"] },
    });
    if (activeOrders > 0) {
      return res.status(409).send({
        message: "This item has active orders. Deactivate it instead of deleting it.",
      });
    }

    await db.collection("menuItems").deleteOne({ _id: item._id });
    res.send({ message: "Menu item deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to delete menu item" });
  }
});

// ---------- পেমেন্ট ইতিহাস ----------
// GET /api/admin/transactions
router.get("/transactions", async (req, res) => {
  try {
    const transactions = await getDB()
      .collection("transactions")
      .aggregate([
        { $sort: { createdAt: -1 } },
        { $limit: 500 },
        {
          $lookup: {
            from: "users",
            localField: "vendorId",
            foreignField: "_id",
            as: "vendor",
          },
        },
        { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            sessionId: 1,
            paymentIntentId: 1,
            amount: 1,
            currency: 1,
            plan: 1,
            status: 1,
            createdAt: 1,
            vendorName: "$vendor.name",
            vendorEmail: "$vendor.email",
          },
        },
      ])
      .toArray();

    res.send(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load transactions" });
  }
});

export default router;