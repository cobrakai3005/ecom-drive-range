import express from "express";
import {
  getUserOrders,
  getOrderDetails,
  updateOrderStatus,
  getAllOrders,
  initiateRazorpayCheckout,
  verifyRazorpayAndCreateOrder,
  getOrderDashboardStats,
  updateOrderAddresses,
} from "../controllers/orders.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";

const router = express.Router();

// User routes
router.get("/dashboard-stats", verifyToken, getOrderDashboardStats);
router.post("/create", verifyToken, initiateRazorpayCheckout);
router.get("/my-orders", verifyToken, getUserOrders);
router.post("/verify-payment", verifyToken, verifyRazorpayAndCreateOrder);

router.get("/my-orders/:id", verifyToken, getOrderDetails);

// Admin routes
router.get("/admin/all", verifyToken, authorize("Admin"), getAllOrders);
router.put(
  "/admin/:id/status",
  verifyToken,
  authorize("Admin", "Staff"),
  updateOrderStatus,
);
router.put(
  "/update-address/:id",
  verifyToken,
  authorize("Customer"),
  updateOrderAddresses,
);
export default router;
