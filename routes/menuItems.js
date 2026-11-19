import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { verifyJWT, verifyRole } from "../auth.js";
import { CATEGORIES, FREE_PLAN_ITEM_LIMIT } from "../constants.js";

const router = Router();

const isUrl = (value) => typeof value === "string" && /^https?:\/\/.+/i.test(value);

router.post("/", verifyJWT, verifyRole("vendor"), async (req, res) => {
  try {
    const { itemName, category, description, price, location, images } = req.body;

    if (typeof itemName !== "string" || itemName.trim().length < 2 || itemName.trim().length > 80) {
      return res.status(400).send({ message: "Item name must be 2 to 80 characters" });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).send({ message: "Invalid category" });
    }
    if (typeof description !== "string" || description.trim().length < 10 || description.trim().length > 1000) {
      return res.status(400).send({ message: "Description must be 10 to 1000 characters" });
    }
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0 || numericPrice > 100000) {
      return res.status(400).send({ message: "Price must be a positive number" });
    }
    if (typeof location !== "string" || location.trim().length < 2 || location.trim().length > 80) {
      return res.status(400).send({ message: "Location must be 2 to 80 characters" });
    }
    if (!Array.isArray(images) || images.length < 1 || images.length > 5 || !images.every(isUrl)) {
      return res.status(400).send({ message: "At least one valid image is required (max 5)" });
    }

    const menuItems = getDB().collection("menuItems");
    const vendorId = new ObjectId(req.user.id);


    if (req.user.subscriptionPlan !== "premium") {
      const activeCount = await menuItems.countDocuments({
        vendorId,
        status: { $in: ["pending", "approved"] },
      });

      if (activeCount >= FREE_PLAN_ITEM_LIMIT) {
        return res.status(403).send({
          message: `Free plan allows a maximum of ${FREE_PLAN_ITEM_LIMIT} active items. Upgrade to Premium to add more.`,
          code: "PLAN_LIMIT_REACHED",
        });
      }
    }

    const newItem = {
      vendorId,
      itemName: itemName.trim(),
      category,
      description: description.trim(),
      price: numericPrice,
      location: location.trim(),
      images,
      status: "pending",
      createdAt: new Date(),
    };

    const result = await menuItems.insertOne(newItem);

    res.status(201).send({
      message: "Menu item submitted. It will be visible after admin approval.",
      itemId: result.insertedId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to add menu item" });
  }
});

export default router;