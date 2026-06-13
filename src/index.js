import express from "express";
import { config } from "dotenv";
import { connect } from "./config/db.js";
config();

const app = express();
const port = process.env.PORT;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Routes Imports

import authRoutes from "./routes/auth.route.js";
import userRoutes from "./routes/user.route.js";
import userAddressRoutes from "./routes/user_address.route.js";
import categoryRoutes from "./routes/category.route.js";
import subCategoryRoutes from "./routes/sub_category.route.js";
import brandRoutes from "./routes/brand.route.js";
import productRoutes from "./routes/product.routes.js";
import availableStock from "./routes/product_stock.route.js";
import guestTokenRoute from "./routes/guest_token.route.js";
import cartRoutes from "./routes/cart.route.js";
import orderRoutes from "./routes/order.route.js";
import shipmentRoutes from "./routes/shipment.route.js";
import paymentMothodsRoutes from "./routes/payment_method.route.js";
import transactionsRoutes from "./routes/transactions.route.js";

import returnsRoutes from "./routes/returns.routes.js";
import warrantyRoutes from "./routes/warranty.routes.js";
import supportRoutes from "./routes/support.routes.js";
import reviewsRoutes from "./routes/reviews.routes.js";
import taxShippingRoutes from "./routes/taxShipping.routes.js";
import auditLogRoutes from "./routes/auditLog.routes.js";
import systemConfigRoutes from "./routes/systemConfig.routes.js";

//Routes Defined

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/user-addresses", userAddressRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/sub-categories", subCategoryRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/products", productRoutes);
app.use("/api/available-stocks", availableStock);
app.use("/api/guests/token", guestTokenRoute);
app.use("/api/carts", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/shipments", shipmentRoutes);
app.use("/api/payment-methods", paymentMothodsRoutes);
app.use("/api/transactions", transactionsRoutes);

app.use("/api/returns", returnsRoutes);
app.use("/api/warranty", warrantyRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/reviews", reviewsRoutes);
app.use("/api/tax-shipping", taxShippingRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/config", systemConfigRoutes);

app.listen(port, async () => {
  await connect();
  console.log(`Server is running on PORT ${port}`);
});
