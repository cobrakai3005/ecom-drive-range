import express from "express";
import {
  getAllMakes,
  getMakeById,
  createMake,
  updateMake,
  deleteMake,
} from "../controllers/vehicleMake.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import upload from "../middlewares/multer.middleware.js";
const router = express.Router();

// Public routes (read-only)
router.get("/get_all_makes", getAllMakes);
router.get("/get_make_by_id/:id", getMakeById);

// Admin only routes
router.post(
  "/create_make",
  verifyToken,
  authorize("Admin"),
  upload.single("logo_url"),
  createMake,
);
router.put(
  "/update_make/:id",
  verifyToken,
  authorize("Admin"),
  upload.single("logo_url"),
  updateMake,
);
router.delete("/delete_make/:id", verifyToken, authorize("Admin"), deleteMake);

export default router;
