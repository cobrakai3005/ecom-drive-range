import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  getUserPaymentMethods,
  addPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
} from "../controllers/paymentMethod.controller.js";

const router = express.Router();

// @route   GET /api/payment-methods
// @desc    Get logged-in user's payment methods
// @access  Customer, Admin (Admin can access all via query param?)
router.get(
  "/",
  verifyToken,
  authorize("Customer", "Admin", "Staff"),
  getUserPaymentMethods,
);

// Optional: Admin can view payment methods of any user
// router.get('/user/:userId', verifyToken, authorize('Admin'), getPaymentMethodsByUserId);

// @route   POST /api/payment-methods
// @desc    Add a new payment method
// @access  Customer, Admin (adding for any user)
router.post("/", verifyToken, authorize("Customer", "Admin"), addPaymentMethod);

// @route   PUT /api/payment-methods/:id
// @desc    Update payment method (set default, activate/deactivate)
// @access  Customer (own), Admin
router.put(
  "/:id",
  verifyToken,
  authorize("Customer", "Admin"),
  updatePaymentMethod,
);

// @route   DELETE /api/payment-methods/:id
// @desc    Delete payment method
// @access  Customer (own), Admin
router.delete(
  "/:id",
  verifyToken,
  authorize("Customer", "Admin"),
  deletePaymentMethod,
);

export default router;
