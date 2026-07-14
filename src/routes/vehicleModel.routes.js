import express from "express";
import {
  getAllModels,
  getModelByIdOrSlug,
  createModel,
  updateModel,
  deleteModel,
  restoreModel,
} from "../controllers/vehicleModel.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import createUpload from "../middlewares/multer.middleware.js";
const router = express.Router();
const upload = createUpload("vehicle_models");

// Public routes (read-only)
router.get("/get_all_models", getAllModels);
router.get("/get_model_by_id/:identifier", getModelByIdOrSlug);

// Admin only routes
router.post(
  "/create_model",
  verifyToken,
  authorize("Admin"),

  (req, res, next) => {
    upload.single("model_image_url")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  createModel,
);
router.put(
  "/update_model/:id",
  verifyToken,
  authorize("Admin"),

  (req, res, next) => {
    upload.single("model_image_url")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  updateModel,
);
router.delete(
  "/delete_model/:id",
  verifyToken,
  authorize("Admin"),
  deleteModel,
);
router.get("/restore/:id", verifyToken, authorize("Admin"), restoreModel);

export default router;
