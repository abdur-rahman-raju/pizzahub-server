import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { verifyJWT, verifyRole } from "../auth.js";

const router = Router();


router.post("/", verifyJWT, verifyRole("customer"), async (req, res) => {
  try {
    const { itemId, deliveryDate, deliveryAddress, message } = req.body;


    if (typeof itemId !== "string" || !/^[a-f\d]{24}$/i.test(itemId)) {
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

export default router;