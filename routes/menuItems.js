import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { verifyJWT, verifyRole } from "../auth.js";
import { CATEGORIES, FREE_PLAN_ITEM_LIMIT } from "../constants.js";

const router = Router();

// ---------- হেল্পার ----------

const isUrl = (value) => typeof value === "string" && /^https?:\/\/.+/i.test(value);

const isValidId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);

// সার্চে বিশেষ চিহ্ন নিরাপদ করা
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ভেন্ডরের তথ্য জোড়া (ইমেইল ছাড়া), ব্লক করা ভেন্ডর বাদ
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

// ফ্রি প্ল্যানের লিমিট পূর্ণ কি না
async function planLimitReached(user) {
  if (user.subscriptionPlan === "premium") return false;
  const count = await getDB()
    .collection("menuItems")
    .countDocuments({
      vendorId: new ObjectId(user.id),
      status: { $in: ["pending", "approved"] },
    });
  return count >= FREE_PLAN_ITEM_LIMIT;
}

// আইটেম লোড করে মালিকানা যাচাই (ব্যর্থ হলে নিজেই রেসপন্স পাঠায়, null ফেরত দেয়)
async function loadOwnedItem(req, res) {
  const { id } = req.params;

  if (!isValidId(id)) {
    res.status(400).send({ message: "Invalid item ID" });
    return null;
  }

  const item = await getDB()
    .collection("menuItems")
    .findOne({ _id: new ObjectId(id) });

  if (!item) {
    res.status(404).send({ message: "Menu item not found" });
    return null;
  }

  if (item.vendorId.toString() !== req.user.id) {
    res.status(403).send({ message: "Forbidden: you can only manage your own items" });
    return null;
  }

  return item;
}

// আপডেটের ডাটা যাচাই (শুধু পাঠানো ফিল্ডগুলো)
function validateItemUpdate(body) {
  const data = {};

  if (body.itemName !== undefined) {
    const v = body.itemName;
    if (typeof v !== "string" || v.trim().length < 2 || v.trim().length > 80) {
      return { error: "Item name must be 2 to 80 characters" };
    }
    data.itemName = v.trim();
  }
  if (body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) return { error: "Invalid category" };
    data.category = body.category;
  }
  if (body.description !== undefined) {
    const v = body.description;
    if (typeof v !== "string" || v.trim().length < 10 || v.trim().length > 1000) {
      return { error: "Description must be 10 to 1000 characters" };
    }
    data.description = v.trim();
  }
  if (body.price !== undefined) {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n <= 0 || n > 100000) {
      return { error: "Price must be a positive number" };
    }
    data.price = n;
  }
  if (body.location !== undefined) {
    const v = body.location;
    if (typeof v !== "string" || v.trim().length < 2 || v.trim().length > 80) {
      return { error: "Location must be 2 to 80 characters" };
    }
    data.location = v.trim();
  }
  if (body.images !== undefined) {
    const v = body.images;
    if (!Array.isArray(v) || v.length < 1 || v.length > 5 || !v.every(isUrl)) {
      return { error: "At least one valid image is required (max 5)" };
    }
    data.images = v;
  }

  return { data };
}

// ---------- নতুন আইটেম যোগ (শুধু ভেন্ডর) ----------

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

    if (await planLimitReached(req.user)) {
      return res.status(403).send({
        message: `Free plan allows a maximum of ${FREE_PLAN_ITEM_LIMIT} active items. Upgrade to Premium to add more.`,
        code: "PLAN_LIMIT_REACHED",
      });
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

// ---------- পাবলিক Browse: সার্চ + ফিল্টার + সর্টিং + পেজিনেশন ----------
// GET /api/menu-items?q=&category=&location=&minPrice=&maxPrice=&sort=&page=&limit=

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

// ---------- হোম পেজের ফিচার্ড আইটেম: Premium ভেন্ডরের আইটেম আগে ----------
// GET /api/menu-items/featured?limit=6

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

// ---------- ফিল্টারের ড্রপডাউনের ডাটা ----------
// GET /api/menu-items/filters

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

// ---------- ভেন্ডরের নিজের সব আইটেম (সব স্ট্যাটাসসহ) ----------
// GET /api/menu-items/mine?status=pending
// (এটা অবশ্যই "/:id" রুটের আগে থাকতে হবে)

router.get("/mine", verifyJWT, verifyRole("vendor"), async (req, res) => {
  try {
    const filter = { vendorId: new ObjectId(req.user.id) };

    const { status } = req.query;
    if (status !== undefined && status !== "") {
      if (!["pending", "approved", "rejected", "inactive"].includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }
      filter.status = status;
    }

    const items = await getDB()
      .collection("menuItems")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(items);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load your menu items" });
  }
});

// ---------- আইটেম ডিটেইলস (লগইন লাগবে) ----------
// GET /api/menu-items/:id

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