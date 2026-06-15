import express from "express";
import {
  getAllModels,
  getModelById,
  createModel,
  updateModel,
  deleteModel,
} from "../controllers/vehicleModel.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import upload from "../middlewares/multer.middleware.js";
const router = express.Router();

// Public routes (read-only)
router.get("/get_all_models", getAllModels);
router.get("/get_model_by_id/:id", getModelById);

// Admin only routes
router.post(
  "/create_model",
  verifyToken,
  authorize("Admin"),

  upload.single("model_image_url"),
  createModel,
);
router.put(
  "/update_model/:id",
  verifyToken,
  authorize("Admin"),
  upload.single("model_image_url"),
  updateModel,
);
router.delete(
  "/delete_model/:id",
  verifyToken,
  authorize("Admin"),
  deleteModel,
);

export default router;
