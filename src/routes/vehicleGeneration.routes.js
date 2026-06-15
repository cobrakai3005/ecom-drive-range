import express from "express";
import {
  getAllGenerations,
  getGenerationById,
  createGeneration,
  updateGeneration,
  deleteGeneration,
} from "../controllers/vehicleGeneration.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";

const router = express.Router();

// Public routes (read-only)
router.get("/get_all_generations", getAllGenerations);
router.get("/get_generation_by_id/:id", getGenerationById);

// Admin only routes
router.post(
  "/create_generation",
  verifyToken,
  authorize("Admin"),
  createGeneration,
);
router.put(
  "/update_generation/:id",
  verifyToken,
  authorize("Admin"),
  updateGeneration,
);
router.delete(
  "/delete_generation/:id",
  verifyToken,
  authorize("Admin"),
  deleteGeneration,
);

export default router;
