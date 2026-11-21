import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { verifyJWT, verifyRole } from "../auth.js";
import { FREE_PLAN_ITEM_LIMIT } from "../constants.js";

const router = express.Router();


function toCounts(rows, keys) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const row of rows) {
    if (row._id in counts) counts[row._id] = row.count;
  }
  return counts;
}

const countByStatus = [{ $group: { _id: "$status", count: { $sum: 1 } } }];


router.get("/vendor", verifyJWT, verifyRole("vendor"), async (req, res) => {
  try {
    const db = getDB();
    const vendorId = new ObjectId(req.user.id);

    const [itemRows, orderRows, revenueRows, recentOrders] = await Promise.all([
      db
        .collection("menuItems")
        .aggregate([{ $match: { vendorId } }, ...countByStatus])
        .toArray(),
      db
        .collection("orders")
        .aggregate([{ $match: { vendorId } }, ...countByStatus])
        .toArray(),
  
      db
        .collection("orders")
        .aggregate([
          { $match: { vendorId, status: "accepted" } },
          {
            $lookup: {
              from: "menuItems",
              localField: "itemId",
              foreignField: "_id",
              as: "item",
            },
          },
          { $unwind: "$item" },
          { $group: { _id: null, revenue: { $sum: "$item.price" } } },
        ])
        .toArray(),
      db
        .collection("orders")
        .aggregate([
          { $match: { vendorId } },
          { $sort: { createdAt: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: "menuItems",
              localField: "itemId",
              foreignField: "_id",
              as: "item",
            },
          },
          { $unwind: { path: "$item", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "users",
              localField: "customerId",
              foreignField: "_id",
              as: "customer",
            },
          },
          { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              status: 1,
              deliveryDate: 1,
              createdAt: 1,
              itemName: "$item.itemName",
              price: "$item.price",
              customerName: "$customer.name",
            },
          },
        ])
        .toArray(),
    ]);

    const items = toCounts(itemRows, ["pending", "approved", "rejected", "inactive"]);
    const orders = toCounts(orderRows, ["pending", "accepted", "rejected", "cancelled"]);

    res.send({
      plan: req.user.subscriptionPlan === "premium" ? "premium" : "free",
      planLimit: FREE_PLAN_ITEM_LIMIT,
      activeItems: items.pending + items.approved,
      totalItems: Object.values(items).reduce((a, b) => a + b, 0),
      items,
      totalOrders: Object.values(orders).reduce((a, b) => a + b, 0),
      orders,
      revenue: revenueRows[0]?.revenue ?? 0,
      recentOrders,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load vendor stats" });
  }
});

export default router;