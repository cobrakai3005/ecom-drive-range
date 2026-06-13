import express from "express";
import {
  getStock,
  setStock,
  adjustStock,
  deleteStock,
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

export default router;
