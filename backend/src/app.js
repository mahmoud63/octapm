require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");
const { createCorsOptions } = require("./config/security");
const authRoutes = require("./routes/auth");
const projectRoutes = require("./routes/projects");
const userRoutes = require("./routes/users");
const companyRoutes = require("./routes/companies");
const configRoutes = require("./routes/config");
const billingRoutes = require("./routes/billing");
const notificationRoutes = require("./routes/notifications");
const taskRoutes = require("./routes/tasks");
const searchRoutes = require("./routes/search");
const permissionRoutes = require("./routes/permissions");
const companyWorkspaceRoutes = require("./routes/company-workspace");
const reportBuilderRoutes = require("./routes/report-builder");
const portfolioRoutes = require("./routes/portfolio");
const workflowInboxRoutes = require("./routes/workflow-inbox");
const {
  requireCloudFrontOriginSecret,
} = require("./middleware/cloudfront-origin");
const { errorHandler, notFoundHandler } = require("./middleware/error-handler");
const {
  apiRateLimiter,
  stripeWebhookLimiter,
} = require("./middleware/rate-limit");
const { sendSuccess } = require("./utils/api-response");
const { openApiSpec } = require("./openapi/spec");

const swaggerDocsMiddleware = () => [
  (_req, res, next) => {
    res.removeHeader("Content-Security-Policy");
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    explorer: true,
    customSiteTitle: "PMcopilots API Docs",
    swaggerOptions: {
      persistAuthorization: true,
      url: "/api/v1/openapi.json",
    },
  }),
];

const createApp = () => {
  const app = express();
  const trustProxyHops = Number.parseInt(
    process.env.TRUST_PROXY_HOPS ||
      (process.env.NODE_ENV === "production" ? "1" : "0"),
    10,
  );
  if (trustProxyHops > 0) {
    app.set("trust proxy", trustProxyHops);
  }

  app.use(helmet());
  app.use(cors(createCorsOptions()));
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }
  app.use(requireCloudFrontOriginSecret);

  app.get("/api/v1/openapi.json", (_req, res) => {
    res.json(openApiSpec);
  });

  app.use("/api/docs", swaggerDocsMiddleware());
  app.use("/api/v1/docs", swaggerDocsMiddleware());
  app.use("/api/v1", apiRateLimiter);

  app.use(
    "/api/v1/webhooks/stripe",
    stripeWebhookLimiter,
    express.raw({ type: "application/json" }),
    require("./routes/stripe-webhook"),
  );
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    return sendSuccess(res, {
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/projects", projectRoutes);
  app.use("/api/v1/companies", companyRoutes);
  app.use("/api/v1/users", userRoutes);
  app.use("/api/v1/config", configRoutes);
  app.use("/api/v1/billing", billingRoutes);
  app.use("/api/v1/notifications", notificationRoutes);
  app.use("/api/v1/tasks", taskRoutes);
  app.use("/api/v1/search", searchRoutes);
  app.use("/api/v1/permissions", permissionRoutes);
  app.use("/api/v1/company", companyWorkspaceRoutes);
  app.use("/api/v1/reports", reportBuilderRoutes);
  app.use("/api/v1/portfolio", portfolioRoutes);
  app.use("/api/v1/workflows", workflowInboxRoutes);
  app.use("/api/v1/integrations", require("./routes/integrations"));
  app.use("/api/v1/public/bids", require("./routes/bid-portal"));
  app.use("/api/v1/public/rfqs", require("./routes/rfq-portal"));
  app.use("/api/v1/assistant", require("./routes/assistant").orgRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
