import express from "express";
import {
  getAllBrands,
  getBrandById,
  createBrand,
  updateBrand,
  deleteBrand,
} from "../controllers/brand.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import upload from "../middlewares/multer.middleware.js";
const router = express.Router();

router.get("/get_all_brands", getAllBrands);
router.get("/get_brand_by_id/:id", verifyToken, getBrandById);
router.post(
  "/create_brand",
  upload.single("logo_url"),
  verifyToken,
  authorize("Admin"),
  createBrand,
);
router.put(
  "/update_brand/:id",
  verifyToken,
  upload.single("logo_url"),
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
