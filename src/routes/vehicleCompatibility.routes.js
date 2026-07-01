import express from "express";
import {
  getCompatibilityByProduct,
  addCompatibility,
  updateCompatibility,
  removeCompatibility,
  getProductsByVehicle,
} from "../controllers/vehicleCompatibility.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";

const router = express.Router();

// Public (or any authenticated user) – depends on your requirements
router.get("/product/:productId", getCompatibilityByProduct);
router.get("/vehicle/:generationId/products", getProductsByVehicle);

// Admin only (modify compatibility)
router.post(
  "/product/:productId",
  verifyToken,
  authorize("Admin"),
  addCompatibility,
);
router.put(
  "/product/:productId",
  verifyToken,
  authorize("Admin"),
  updateCompatibility,
);
router.delete("/:id", verifyToken, authorize("Admin"), removeCompatibility);

export default router;
