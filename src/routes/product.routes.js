import express from "express";
import {
  createProduct,
  deleteProduct,
  getAllProducts,
  getProductByIdOrSlug,
  toggleProductStatus,
  updateProduct,
} from "../controllers/product.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import upload from "../middlewares/multer.middleware.js";
const router = express.Router();

router.get("/get_all_products", getAllProducts);
router.get("/get_product_by_id/:identifier", verifyToken, getProductByIdOrSlug);
router.post("/create_product", verifyToken, authorize("Admin"), createProduct);
router.put(
  "/update_product/:id",
  verifyToken,
  authorize("Admin"),
  updateProduct,
);
router.delete(
  "/delete_product/:id",
  verifyToken,
  authorize("Admin"),
  deleteProduct,
);
router.patch(
  "/toggle_status/:id",
  verifyToken,
  authorize("Admin"),
  toggleProductStatus,
);

// Product Vaiations

import {
  getAllVariationTypes,
  getVariationTypeById,
  createVariationType,
  updateVariationType,
  deleteVariationType,
} from "../controllers/product_variations.controller.js";

router.get("/get_all_variations", getAllVariationTypes);
router.get("/get_variation_by_id/:id", verifyToken, getVariationTypeById);
router.post(
  "/create_variation",
  verifyToken,
  authorize("Admin", "Staff"),
  createVariationType,
);
router.put(
  "/update_variation/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  updateVariationType,
);
router.delete(
  "/delete_variation/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  deleteVariationType,
);

// Product images

import {
  getProductImages,
  addProductImage,
  deleteProductImage,
  reorderProductImages,
} from "../controllers/product_images.controller.js";

router.get("/:productId/images", getProductImages);
router.post(
  "/:productId/images",
  verifyToken,
  authorize("Admin", "Staff"),
  upload.single("product_images"),
  addProductImage,
);
router.delete(
  "/images/:imageId",
  verifyToken,
  authorize("Admin", "Staff"),
  deleteProductImage,
);
router.patch(
  "/:productId/images/reorder",
  verifyToken,
  authorize("Admin", "Staff"),
  reorderProductImages,
);

//--------Products Items---------
import {
  getAllProductItems,
  getProductItemById,
  createProductItem,
  updateProductItem,
  deleteProductItem,
} from "../controllers/product_items.controller.js";

router.get("/get_all_items", getAllProductItems);
router.get("/get_item_by_id/:id", getProductItemById);
router.post("/create_item", createProductItem);
router.put("/update_item/:id", updateProductItem);
router.delete("/delete_item/:id", deleteProductItem);

//--------Products Attributes---------

import {
  getProductAttributes,
  addProductAttribute,
  updateProductAttribute,
  deleteProductAttribute,
} from "../controllers/product_attribubtes.controller.js";

router.get("/:productId/attributes/get_all_attributes", getProductAttributes);
router.post("/:productId/attributes/create_attibute", addProductAttribute);
router.put("/attributes/update_attribute/:attributeId", updateProductAttribute);
router.delete("/attributes/delete_attribute/:attributeId", deleteProductAttribute);

export default router;
