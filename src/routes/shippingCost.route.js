import express from "express";

import {
  createShippingCost,
  getAllShippingCosts,
  getShippingCostById,
  getShippingCostByState,
  updateShippingCost,
  updateShippingCostStatus,
  deleteShippingCost,
} from "../controllers/shippingCost.controller.js";

// Change these imports according to your project
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Public/customer route
|--------------------------------------------------------------------------
| Keep this before /:id, otherwise "state" can be interpreted as an ID.
*/

router.get("/state/:state", getShippingCostByState);

/*
|--------------------------------------------------------------------------
| Admin and Staff routes
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  verifyToken,
  authorize("Admin", "Staff"),
  getAllShippingCosts,
);

router.get(
  "/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  getShippingCostById,
);

router.post(
  "/",
  verifyToken,
  authorize("Admin", "Staff"),
  createShippingCost,
);

router.put(
  "/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  updateShippingCost,
);

router.patch(
  "/:id/status",
  verifyToken,
  authorize("Admin", "Staff"),
  updateShippingCostStatus,
);

router.delete(
  "/:id",
  verifyToken,
  authorize("Admin"),
  deleteShippingCost,
);

export default router;
