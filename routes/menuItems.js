import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { verifyJWT, verifyRole } from "../auth.js";
import { CATEGORIES, FREE_PLAN_ITEM_LIMIT } from "../constants.js";

const router = Router();

const isUrl = (value) => typeof value === "string" && /^https?:\/\/.+/i.test(value);

const isValidId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const vendorStages = [
  {
    $lookup: {
      from: "users",
      localField: "vendorId",
      foreignField: "_id",
      as: "vendor",
    },
  },
  { $unwind: "$vendor" },
  { $match: { "vendor.isBlocked": { $ne: true } } },
  {
    $addFields: {
      isVendorPremium: {
        $and: [
          { $eq: ["$vendor.subscriptionPlan", "premium"] },
          { $gt: ["$vendor.subscriptionExpiresAt", "$$NOW"] },
        ],
      },
    },
  },
  {
    $project: {
      itemName: 1,
      category: 1,
      description: 1,
      price: 1,
      location: 1,
      images: 1,
      status: 1,
      createdAt: 1,
      vendorId: 1,
      isVendorPremium: 1,
      vendor: {
        _id: "$vendor._id",
        name: "$vendor.name",
        businessName: "$vendor.businessName",
        image: "$vendor.image",
      },
    },
  },
];

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

router.get("/", async (req, res) => {
  try {
    const { q, category, location, minPrice, maxPrice, sort, page, limit } = req.query;

    const match = { status: "approved" };

    if (typeof q === "string" && q.trim()) {
      match.itemName = { $regex: escapeRegex(q.trim()), $options: "i" };
    }

    if (category !== undefined && category !== "") {
      if (!CATEGORIES.includes(category)) {
        return res.status(400).send({ message: "Invalid category" });
      }
      match.category = category;
    }

    if (typeof location === "string" && location.trim()) {
      match.location = {
        $regex: `^${escapeRegex(location.trim())}$`,
        $options: "i",
      };
    }

    const min = Number(minPrice);
    const max = Number(maxPrice);
    if ((minPrice && Number.isFinite(min)) || (maxPrice && Number.isFinite(max))) {
      match.price = {};
      if (minPrice && Number.isFinite(min)) match.price.$gte = min;
      if (maxPrice && Number.isFinite(max)) match.price.$lte = max;
    }

    let sortStage = { createdAt: -1, _id: -1 };
    if (sort === "price_asc") sortStage = { price: 1, _id: 1 };
    if (sort === "price_desc") sortStage = { price: -1, _id: 1 };

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 9, 1), 50);

    const [result] = await getDB()
      .collection("menuItems")
      .aggregate([
        { $match: match },
        ...vendorStages,
        { $sort: sortStage },
        {
          $facet: {
            items: [{ $skip: (pageNum - 1) * limitNum }, { $limit: limitNum }],
            total: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    const total = result.total[0]?.count || 0;

    res.send({
      items: result.items,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load menu items" });
  }
});

router.get("/featured", async (req, res) => {
  try {
    const limitNum = Math.min(Math.max(parseInt(req.query.limit) || 6, 1), 12);

    const items = await getDB()
      .collection("menuItems")
      .aggregate([
        { $match: { status: "approved" } },
        ...vendorStages,
        { $sort: { isVendorPremium: -1, createdAt: -1 } },
        { $limit: limitNum },
      ])
      .toArray();

    res.send(items);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load featured items" });
  }
});


router.get("/filters", async (req, res) => {
  try {
    const locations = await getDB()
      .collection("menuItems")
      .distinct("location", { status: "approved" });

    res.send({
      categories: CATEGORIES,
      locations: locations.sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load filters" });
  }
});


router.get("/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({ message: "Invalid item ID" });
    }

    const [item] = await getDB()
      .collection("menuItems")
      .aggregate([{ $match: { _id: new ObjectId(id) } }, ...vendorStages])
      .toArray();

    if (!item) {
      return res.status(404).send({ message: "Menu item not found" });
    }


    const isOwner =
      req.user.role === "vendor" && item.vendorId.toString() === req.user.id;
    const isAdmin = req.user.role === "admin";

    if (item.status !== "approved" && !isOwner && !isAdmin) {
      return res.status(404).send({ message: "Menu item not found" });
    }

    res.send(item);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load menu item" });
  }
});

export default router;