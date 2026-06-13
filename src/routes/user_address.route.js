// routes/addressRoutes.js
import express from "express";
const router = express.Router();
import { pool } from "../config/db.js";
import verifyToken from "../middlewares/auth.middleware.js";
import {
  createAddress,
  deleteAddress,
  deleveryAddress,
  getAddressById,
  getAllAddresses,
  updateAddress,
} from "../controllers/user_addresses.controller.js";
import {
  authorize,
  checkAddressOwnership,
} from "../middlewares/authorize.middleware.js";

//  Customer & Admin Routes
// GET /api/addresses – Get addresses (customer: own active; admin: all)
router.get("/", verifyToken, authorize("Admin"), getAllAddresses);

// GET /api/user-addresses/:addressId – Get single address
router.get(
  "/:addressId",
  verifyToken,
  authorize("Admin", "Customer"), // allow both roles
  checkAddressOwnership, // but enforce ownership for customers
  getAddressById,
);

// POST /api/addresses – Create new address (customer only)
router.post(
  "/create_address",
  verifyToken,
  authorize("Admin", "Customer"),
  createAddress,
);

// PUT /api/addresses/:addressId – Update address (customer: own; admin: any)
router.put(
  "/update-address/:addressId",
  verifyToken,
  authorize("Admin", "Customer"),
  checkAddressOwnership,
  updateAddress,
);

// DELETE /api/addresses/:addressId – Soft delete (customer: own; admin: any)
router.delete(
  "/delete_address/:addressId",
  verifyToken,
  authorize("Admin", "Customer"),
  checkAddressOwnership,
  deleteAddress,
);

// PUT /api/addresses/default – Set a default address (customer only)
router.put("/default", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Only customers can set default address",
      });
    }
    const { address_id, address_type } = req.body;
    if (!address_id || !address_type) {
      return res.status(400).json({
        success: false,
        message: "address_id and address_type required",
      });
    }

    const userId = req.user.id;
    // Verify address exists, belongs to user, and is not deleted
    const [addr] = await pool.query(
      "SELECT address_id FROM user_addresses WHERE address_id = ? AND user_id = ? AND is_deleted = FALSE",
      [address_id, userId],
    );
    if (addr.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }

    // Unset old default for this type
    await pool.query(
      "UPDATE user_addresses SET is_default = FALSE WHERE user_id = ? AND address_type = ? AND is_deleted = FALSE",
      [userId, address_type],
    );
    // Set new default
    await pool.query(
      "UPDATE user_addresses SET is_default = TRUE WHERE address_id = ?",
      [address_id],
    );
    res.json({ success: true, message: "Default address updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

//  Delivery Agent Route (read-only via order context)
// Example: GET /api/orders/:orderId/delivery-address – returns address for the order assigned to agent
// This would be placed in a separate orders route file, but for completeness:

router.get(
  "/order/:orderId/delivery-address",
  verifyToken,
  async (req, res) => {
    try {
      if (req.user.role !== "delivery") {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      const { orderId } = req.params;
      const agentId = req.user.id;

      // Check that this order is assigned to this delivery agent (adjust your orders table)
      const [order] = await pool.query(
        "SELECT user_address_id FROM orders WHERE order_id = ? AND delivery_agent_id = ?",
        [orderId, agentId],
      );
      if (order.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found or not assigned to you",
        });
      }
      const addressId = order[0].user_address_id;
      const [address] = await pool.query(
        "SELECT full_name, phone, line1, line2, landmark, city, state, postal_code, country FROM user_addresses WHERE address_id = ? AND is_deleted = FALSE",
        [addressId],
      );
      if (address.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Address not found" });
      }
      res.json({ success: true, data: address[0] });
    } catch (error) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

export default router;
