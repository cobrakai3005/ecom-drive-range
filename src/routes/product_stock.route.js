import express from "express";
import {
  getStock,
  setStock,
  adjustStock,
  deleteStock,
  getStockStatus, // <-- new
  updateLowStockThreshold, // <-- new
  canBackorder, // <-- new
  getProductsNeedingReorder, // <-- new
} from "../controllers/product_stock.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";

const router = express.Router();

router.get(
  "/items/:productItemId/stock",
  verifyToken,
  authorize("Admin", "Staff"),
  getStock,
);
router.put(
  "/items/:productItemId/stock",
  verifyToken,
  authorize("Admin", "Staff"),
  setStock,
);
router.patch(
  "/items/:productItemId/stock/adjust",
  verifyToken,
  authorize("Admin", "Staff"),
  adjustStock,
);
router.delete(
  "/stock/:stockId",
  verifyToken,
  authorize("Admin", "Staff"),
  deleteStock,
);

// ---------- NEW ROUTES ----------
// Get detailed stock status with alert message
router.get(
  "/items/:productItemId/stock/status",
  verifyToken,
  authorize("Admin", "Staff"),
  getStockStatus,
);

// Update only the low‑stock threshold
router.put(
  "/items/:productItemId/stock/threshold",
  verifyToken,
  authorize("Admin", "Staff"),
  updateLowStockThreshold,
);

// Check if backorder is allowed for a requested quantity
router.post(
  "/items/:productItemId/stock/backorder",
  verifyToken,
  authorize("Admin", "Staff"),
  canBackorder,
);

// Get all products that need reordering (below threshold)
router.get(
  "/stock/reorder",
  verifyToken,
  authorize("Admin", "Staff"),
  getProductsNeedingReorder,
);

export default router;
