import { Router } from "express";
import { authRouter } from "./auth.routes";
import { businessRouter } from "./business.routes";
import { staffRouter } from "./staff.routes";
import { tablesRouter } from "./tables.routes";
import { categoriesRouter } from "./categories.routes";
import { productsRouter } from "./products.routes";
import { ordersRouter } from "./orders.routes";
import { ingredientsRouter } from "./ingredients.routes";
import { analyticsRouter } from "./analytics.routes";
import { publicRouter } from "./public.routes";
import { platformRouter } from "./platform.routes";
import { walletRouter } from "./wallet.routes";

export const apiRouter = Router();

// ---- Publik (dipakai oleh Self-Order pelanggan, tanpa login) ----
apiRouter.use("/public", publicRouter);

// ---- Butuh login (Frontoffice: kasir/barista, BackOffice: owner) ----
apiRouter.use("/auth", authRouter);
apiRouter.use("/business", businessRouter);
apiRouter.use("/wallet", walletRouter);
apiRouter.use("/staff", staffRouter);
apiRouter.use("/tables", tablesRouter);
apiRouter.use("/categories", categoriesRouter);
apiRouter.use("/products", productsRouter);
apiRouter.use("/orders", ordersRouter);
apiRouter.use("/ingredients", ingredientsRouter);
apiRouter.use("/analytics", analyticsRouter);

// ---- Platform admin internal (login & cookie terpisah dari tenant) ----
apiRouter.use("/platform", platformRouter);
