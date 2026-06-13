import express from "express";
import {
  createOrder,
  getUserOrders,
  getOrderDetails,
  updateOrderStatus,
  getAllOrders,
} from "../controllers/orders.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";

const router = express.Router();

// User routes
router.post("/create", verifyToken, createOrder);
router.get("/my-orders", verifyToken, getUserOrders);
router.get("/my-orders/:id", verifyToken, getOrderDetails);

// Admin routes
router.get("/admin/all", verifyToken, authorize("Admin"), getAllOrders);
router.put(
  "/admin/:id/status",
  verifyToken,
  authorize("Admin", "Staff"),
  updateOrderStatus,
);

export default router;
