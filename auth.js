
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { getDB } from "./db.js";

let jwks;

function getJWKS() {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${process.env.AUTH_URL}/api/auth/jwks`)
    );
  }

  return jwks;
}

export async function verifyJWT(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).send({
        message: "Unauthorized: token missing",
      });
    }

    const token = header.split(" ")[1];

    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: process.env.AUTH_URL,
      audience: process.env.AUTH_URL,
    });

    if (!payload.id || !ObjectId.isValid(payload.id)) {
      return res.status(401).send({
        message: "Unauthorized: invalid token",
      });
    }

    const user = await getDB()
      .collection("users")
      .findOne({ _id: new ObjectId(payload.id) });

    if (!user) {
      return res.status(401).send({
        message: "Unauthorized: user not found",
      });
    }

    if (user.isBlocked) {
      return res.status(403).send({
        message: "Forbidden: your account is blocked",
      });
    }


    const isPremium =
      user.subscriptionPlan === "premium" &&
      user.subscriptionExpiresAt &&
      new Date(user.subscriptionExpiresAt) > new Date();


    req.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      subscriptionPlan: isPremium ? "premium" : "free",
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
    };

    next();
  } catch (error) {
    return res.status(401).send({
      message: "Unauthorized: invalid or expired token",
    });
  }
}


export function verifyRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).send({
        message: "Forbidden: you do not have access",
      });
    }

    next();
  };
}
