import express from "express";
import {
  getAllBrands,
  getBrandByIdOrSlug,
  createBrand,
  updateBrand,
  deleteBrand,
} from "../controllers/brand.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import upload from "../middlewares/multer.middleware.js";
const router = express.Router();

router.get("/get_all_brands", getAllBrands);
router.get("/get_brand_by_id/:identifier", verifyToken, getBrandByIdOrSlug);
router.post(
  "/create_brand",
  (req, res, next) => {
    upload.single("logo_url")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  verifyToken,
  authorize("Admin"),
  createBrand,
);
router.put(
  "/update_brand/:id",
  verifyToken,
  (req, res, next) => {
    upload.single("logo_url")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  authorize("Admin"),
  updateBrand,
);
router.delete(
  "/delete_brand/:id",
  verifyToken,
  authorize("Admin"),
  deleteBrand,
);

export default router;
