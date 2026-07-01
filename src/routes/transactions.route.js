import express from "express";
import { authorize } from "../middlewares/authorize.middleware.js";
import verifyToken from "../middlewares/auth.middleware.js";
import {
  getAllTransactions,
  createTransaction,
  updateTransactionStatus,
  getTransactionById,
} from "../controllers/transactions.controller.js";

const router = express.Router();

// @route   GET /api/transactions/order/:orderId
// @desc    Get all transactions for an order
// @access  Admin, Staff, Customer (own order)
router.get(
  "/",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  getAllTransactions,
);

// @route   GET /api/transactions/:id
// @desc    Get transaction by ID
// @access  Admin, Staff, Customer (if owns related order)
router.get(
  "/:id",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  getTransactionById,
);

// @route   POST /api/transactions
// @desc    Create a new transaction (usually by payment gateway)
// @access  Admin, Staff
router.post("/", verifyToken, authorize("Admin", "Staff"), createTransaction);

// @route   PATCH /api/transactions/:id/status
// @desc    Update transaction status (webhook or manual)
// @access  Admin, Staff
router.patch(
  "/:id/status",
  verifyToken,
  authorize("Admin", "Staff"),
  updateTransactionStatus,
);

export default router;
