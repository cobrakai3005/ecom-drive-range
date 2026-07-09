import express from "express";
import {
  getAllMakes,
  getMakeByIdOrSlug,
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
router.get("/get_make_by_id/:identifier", getMakeByIdOrSlug);

// Admin only routes
router.post(
  "/create_make",
  verifyToken,
  authorize("Admin"),
  (req, res, next) => {
    upload.single("logo_url")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  createMake,
);
router.put(
  "/update_make/:id",
  verifyToken,
  authorize("Admin"),
  (req, res, next) => {
    upload.single("logo_url")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  updateMake,
);
router.delete("/delete_make/:id", verifyToken, authorize("Admin"), deleteMake);

export default router;
