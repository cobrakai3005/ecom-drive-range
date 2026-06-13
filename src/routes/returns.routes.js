import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  requestReturn,
  updateReturnStatus,
  getUserReturns,
  getAllReturns,
  getReturnDetails,
} from "../controllers/returns.controller.js";

const router = express.Router();

// Customer routes
router.post("/request", verifyToken, authorize("Customer"), requestReturn);
router.get("/my-returns", verifyToken, authorize("Customer"), getUserReturns);
router.get(
  "/my-returns/:id",
  verifyToken,
  authorize("Customer"),
  getReturnDetails,
);

// Admin & Staff routes
router.get(
  "/admin/all",
  verifyToken,
  authorize("Admin", "Staff"),
  getAllReturns,
);
router.get(
  "/admin/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  getReturnDetails,
);
router.put(
  "/admin/:id/status",
  verifyToken,
  authorize("Admin", "Staff"),
  updateReturnStatus,
);

export default router;
