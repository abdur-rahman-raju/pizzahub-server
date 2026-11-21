import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { verifyJWT, verifyRole } from "../auth.js";

const router = Router();

const ORDER_STATUSES = ["pending", "accepted", "rejected", "cancelled"];

const isValidId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);

// অর্ডারের সাথে আইটেম, ভেন্ডর ও কাস্টমারের তথ্য জোড়া
const orderStages = [
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
      localField: "vendorId",
      foreignField: "_id",
      as: "vendor",
    },
  },
  { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
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
      itemId: 1,
      vendorId: 1,
      customerId: 1,
      deliveryDate: 1,
      deliveryAddress: 1,
      message: 1,
      status: 1,
      createdAt: 1,
      updatedAt: 1,
      item: {
        _id: "$item._id",
        itemName: "$item.itemName",
        images: "$item.images",
        price: "$item.price",
        category: "$item.category",
        location: "$item.location",
      },
      vendor: {
        _id: "$vendor._id",
        name: "$vendor.name",
        businessName: "$vendor.businessName",
      },
      customer: {
        _id: "$customer._id",
        name: "$customer.name",
        email: "$customer.email",
        image: "$customer.image",
      },
    },
  },
];

// শর্ত মেলেনি: অর্ডার নেই / অন্যের অর্ডার / pending নয়, কারণটা জানিয়ে দেওয়া
async function explainFailure(res, orderId, ownerField, userId, notPendingMessage) {
  const order = await getDB()
    .collection("orders")
    .findOne({ _id: new ObjectId(orderId) });

  if (!order) {
    return res.status(404).send({ message: "Order not found" });
  }
  if (order[ownerField].toString() !== userId) {
    return res.status(403).send({ message: "Forbidden: this is not your order" });
  }
  return res.status(409).send({ message: notPendingMessage });
}

// ---------- নতুন অর্ডার (শুধু কাস্টমার) ----------
// POST /api/orders   body: { itemId, deliveryDate, deliveryAddress, message }
router.post("/", verifyJWT, verifyRole("customer"), async (req, res) => {
  try {
    const { itemId, deliveryDate, deliveryAddress, message } = req.body;

    if (!isValidId(itemId)) {
      return res.status(400).send({ message: "Invalid item ID" });
    }

    if (
      typeof deliveryDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ||
      Number.isNaN(Date.parse(deliveryDate)) ||
      new Date(deliveryDate).toISOString().slice(0, 10) !== deliveryDate
    ) {
      return res.status(400).send({ message: "Delivery date must be a valid date" });
    }

    // টাইমজোনের পার্থক্যের জন্য এক দিনের ছাড়
    const limit = new Date();
    limit.setUTCHours(0, 0, 0, 0);
    limit.setUTCDate(limit.getUTCDate() - 1);
    if (new Date(deliveryDate) < limit) {
      return res.status(400).send({ message: "Delivery date cannot be in the past" });
    }

    if (
      typeof deliveryAddress !== "string" ||
      deliveryAddress.trim().length < 5 ||
      deliveryAddress.trim().length > 200
    ) {
      return res
        .status(400)
        .send({ message: "Delivery address must be 5 to 200 characters" });
    }

    const note = message === undefined || message === null ? "" : message;
    if (typeof note !== "string" || note.trim().length > 300) {
      return res.status(400).send({ message: "Message must be 300 characters or less" });
    }

    const db = getDB();
    const [item] = await db
      .collection("menuItems")
      .aggregate([
        { $match: { _id: new ObjectId(itemId) } },
        {
          $lookup: {
            from: "users",
            localField: "vendorId",
            foreignField: "_id",
            as: "vendor",
          },
        },
        { $unwind: "$vendor" },
      ])
      .toArray();

    if (!item) {
      return res.status(404).send({ message: "Menu item not found" });
    }
    if (item.status !== "approved" || item.vendor.isBlocked) {
      return res
        .status(400)
        .send({ message: "This item is not available for ordering" });
    }

    const customerId = new ObjectId(req.user.id);
    if (item.vendorId.equals(customerId)) {
      return res.status(403).send({ message: "You cannot order your own item" });
    }

    const orders = db.collection("orders");
    const duplicate = await orders.findOne({
      itemId: item._id,
      customerId,
      deliveryDate,
      status: { $in: ["pending", "accepted"] },
    });
    if (duplicate) {
      return res.status(409).send({
        message: "You already have an active order for this item on this date",
      });
    }

    const result = await orders.insertOne({
      itemId: item._id,
      vendorId: item.vendorId,
      customerId,
      deliveryDate,
      deliveryAddress: deliveryAddress.trim(),
      message: note.trim(),
      status: "pending",
      createdAt: new Date(),
    });

    res.status(201).send({
      message: "Order placed successfully",
      orderId: result.insertedId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to place order" });
  }
});

// ---------- কাস্টমারের নিজের অর্ডার ----------
// GET /api/orders/mine?status=pending
router.get("/mine", verifyJWT, verifyRole("customer"), async (req, res) => {
  try {
    const match = { customerId: new ObjectId(req.user.id) };

    const { status } = req.query;
    if (status !== undefined && status !== "") {
      if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }
      match.status = status;
    }

    const orders = await getDB()
      .collection("orders")
      .aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        { $limit: 200 },
        ...orderStages,
      ])
      .toArray();

    res.send(orders);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load your orders" });
  }
});

// ---------- ভেন্ডরের আইটেমের ওপর আসা অর্ডার ----------
// GET /api/orders/vendor?status=pending
router.get("/vendor", verifyJWT, verifyRole("vendor"), async (req, res) => {
  try {
    const match = { vendorId: new ObjectId(req.user.id) };

    const { status } = req.query;
    if (status !== undefined && status !== "") {
      if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }
      match.status = status;
    }

    const orders = await getDB()
      .collection("orders")
      .aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        { $limit: 200 },
        ...orderStages,
      ])
      .toArray();

    res.send(orders);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load customer orders" });
  }
});

// ---------- একটা অর্ডারের বিস্তারিত (শুধু ওই অর্ডারের কাস্টমার বা ভেন্ডর) ----------
// GET /api/orders/:id
router.get("/:id", verifyJWT, verifyRole("customer", "vendor"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).send({ message: "Invalid order ID" });
    }

    const [order] = await getDB()
      .collection("orders")
      .aggregate([{ $match: { _id: new ObjectId(id) } }, ...orderStages])
      .toArray();

    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }

    const ownerField = req.user.role === "vendor" ? "vendorId" : "customerId";
    if (order[ownerField].toString() !== req.user.id) {
      return res.status(403).send({ message: "Forbidden: this is not your order" });
    }

    res.send(order);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load order" });
  }
});

// ---------- ভেন্ডর: accept / reject (শুধু pending, একবারই) ----------
// PATCH /api/orders/:id/status   body: { "status": "accepted" | "rejected" }
router.patch("/:id/status", verifyJWT, verifyRole("vendor"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).send({ message: "Invalid order ID" });
    }
    if (!["accepted", "rejected"].includes(status)) {
      return res
        .status(400)
        .send({ message: "Status must be either accepted or rejected" });
    }

    const result = await getDB()
      .collection("orders")
      .updateOne(
        {
          _id: new ObjectId(id),
          vendorId: new ObjectId(req.user.id),
          status: "pending",
        },
        { $set: { status, updatedAt: new Date() } }
      );

    if (result.matchedCount === 0) {
      return explainFailure(
        res,
        id,
        "vendorId",
        req.user.id,
        "Only pending orders can be accepted or rejected, and only once"
      );
    }

    res.send({ message: `Order ${status} successfully`, status });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to update order status" });
  }
});

// ---------- কাস্টমার: নিজের pending অর্ডার cancel ----------
// PATCH /api/orders/:id/cancel
router.patch("/:id/cancel", verifyJWT, verifyRole("customer"), async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({ message: "Invalid order ID" });
    }

    const result = await getDB()
      .collection("orders")
      .updateOne(
        {
          _id: new ObjectId(id),
          customerId: new ObjectId(req.user.id),
          status: "pending",
        },
        { $set: { status: "cancelled", updatedAt: new Date() } }
      );

    if (result.matchedCount === 0) {
      return explainFailure(
        res,
        id,
        "customerId",
        req.user.id,
        "Only pending orders can be cancelled"
      );
    }

    res.send({ message: "Order cancelled successfully", status: "cancelled" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to cancel order" });
  }
});

export default router;