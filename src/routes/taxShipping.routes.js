import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  getAllTaxRates,
  createTaxRate,
  updateTaxRate,
  deleteTaxRate,
  getAllShippingMethods,
  createShippingMethod,
  updateShippingMethod,
  deleteShippingMethod,
} from "../controllers/taxShipping.controller.js";

const router = express.Router();

// Tax rates (Admin & Staff only)
router.get("/tax", verifyToken, authorize("Admin", "Staff"), getAllTaxRates);
router.post("/tax", verifyToken, authorize("Admin", "Staff"), createTaxRate);
router.put("/tax/:id", verifyToken, authorize("Admin", "Staff"), updateTaxRate);
router.delete("/tax/:id", verifyToken, authorize("Admin"), deleteTaxRate);

// Shipping methods (Admin & Staff only)
router.get(
  "/shipping",
  verifyToken,
  authorize("Admin", "Staff"),
  getAllShippingMethods,
);
router.post(
  "/shipping",
  verifyToken,
  authorize("Admin", "Staff"),
  createShippingMethod,
);
router.put(
  "/shipping/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  updateShippingMethod,
);
router.delete(
  "/shipping/:id",
  verifyToken,
  authorize("Admin"),
  deleteShippingMethod,
);

export default router;
