import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { verifyJWT } from "../auth.js";

const router = Router();

router.patch("/profile", verifyJWT, async (req, res) => {
  try {
    const { name, image, businessName } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60) {
        return res
          .status(400)
          .send({ message: "Name must be between 2 and 60 characters" });
      }
      updates.name = name.trim();
    }

    if (image !== undefined) {
      if (image !== "" && !/^https?:\/\/.+/i.test(image)) {
        return res.status(400).send({ message: "Image must be a valid URL" });
      }
      updates.image = image;
    }

    if (businessName !== undefined) {
      if (req.user.role !== "vendor") {
        return res
          .status(403)
          .send({ message: "Only vendors can set a business name" });
      }
      if (
        typeof businessName !== "string" ||
        businessName.trim().length < 2 ||
        businessName.trim().length > 80
      ) {
        return res
          .status(400)
          .send({ message: "Business name must be between 2 and 80 characters" });
      }
      updates.businessName = businessName.trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).send({ message: "No valid fields to update" });
    }

    updates.updatedAt = new Date();


    await getDB()
      .collection("users")
      .updateOne({ _id: new ObjectId(req.user.id) }, { $set: updates });

    const updatedUser = await getDB()
      .collection("users")
      .findOne(
        { _id: new ObjectId(req.user.id) },
        { projection: { name: 1, email: 1, image: 1, role: 1, businessName: 1, subscriptionPlan: 1 } }
      );

    res.send({ message: "Profile updated successfully", user: updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to update profile" });
  }
});

export default router;