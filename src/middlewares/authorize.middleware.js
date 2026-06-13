import pool from "../config/db.js";

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user.role;
    console.log(userRole);
    console.log(allowedRoles);
    
    if (allowedRoles.includes(userRole)) {
      next(); // allowed
    } else {
      
      res.status(403).json({ success: false, message: "Access denied" });
    }
  };
}

// middleware/checkAddressOwnership.js
export const checkAddressOwnership = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    const { id: userId, role } = req.user;

    // Admins are always allowed
    if (role === "Admin") return next();

    // For customers (or any other role), check ownership
    const [rows] = await pool.query(
      "SELECT user_id FROM user_addresses WHERE id = ? AND is_deleted = FALSE",
      [addressId],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }

    if (rows[0].user_id !== userId) {
      return res
        .status(403)
        .json({ success: false, message: "Access denied – not your address" });
    }

    next();
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Server error checkOwnerShip" });
  }
};

import jwt from "jsonwebtoken";

export const authenticateAndHandleGuests = (req, res, next) => {
  // 1. Check for JWT in Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  let userId = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // should contain { id, role, ... }
    } catch (err) {
      // Invalid token – but we still allow guest access, so just log and ignore
      console.warn("Invalid JWT, proceeding as guest");
    }
  }
  // 2. session_token (from header) is NOT attached to req.user – it's used separately in cart controller
  //    But we don't need to block here.
  next();
};
