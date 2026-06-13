import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  getAllShipments,
  getShipmentById,
  createShipment,
  updateShipmentStatus,
  deleteShipment,
} from "../controllers/shipment.controller.js";

const router = express.Router();

// @route   GET /api/shipments
// @desc    Get all shipments
// @access  Admin, Staff
router.get("/", verifyToken, authorize("Admin", "Staff"), getAllShipments);

// @route   GET /api/shipments/:id
// @desc    Get shipment by ID
// @access  Admin, Staff, Customer (only if order belongs to customer)
router.get(
  "/:id",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  getShipmentById,
);

// @route   POST /api/shipments
// @desc    Create new shipment
// @access  Admin, Staff
router.post("/", verifyToken, authorize("Admin", "Staff"), createShipment);

// @route   PATCH /api/shipments/:id/status
// @desc    Update shipment status
// @access  Admin, Staff
router.patch(
  "/:id/status",
  verifyToken,
  authorize("Admin", "Staff"),
  updateShipmentStatus,
);

// @route   DELETE /api/shipments/:id
// @desc    Delete a shipment
// @access  Admin only
router.delete("/:id", verifyToken, authorize("Admin"), deleteShipment);

export default router;
