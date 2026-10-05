require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");
const { createCorsOptions, getTrustProxyHops } = require("./config/security");
const {
  RELEASE_HEADER,
  getRelease,
  releaseHeaderValue,
} = require("./config/release");
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
const { requireOrganizationMembership } = require("./middleware/auth");
const { errorHandler, notFoundHandler } = require("./middleware/error-handler");
const { requestId } = require("./middleware/request-id");
const { rejectNullBytes } = require("./middleware/reject-null-bytes");
const {
  requestLog,
  resolveRequestLogFormat,
} = require("./middleware/request-log");
const { createHealthRouter } = require("./routes/service-health");
const {
  apiRateLimiter,
  stripeWebhookLimiter,
} = require("./middleware/rate-limit");
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
  // One hop behind the load balancer, two behind CloudFront then the load
  // balancer; production refuses anything else at boot (config/security.js).
  const trustProxyHops = getTrustProxyHops();
  if (trustProxyHops > 0) {
    app.set("trust proxy", trustProxyHops);
  }

  app.use(helmet());
  app.use(cors(createCorsOptions()));
  app.use(requestId);
  // Which build answered, on every response, so a rolling deploy can be
  // watched from outside and a support report names the release.
  const release = getRelease();
  app.use((_req, res, next) => {
    res.setHeader(RELEASE_HEADER, releaseHeaderValue(release));
    next();
  });
  // JSON lines with secrets masked in production, morgan's coloured lines in
  // local development as always, nothing under jest (REQUEST_LOG_FORMAT).
  const logFormat = resolveRequestLogFormat();
  if (logFormat === "json") {
    app.use(requestLog);
  } else if (logFormat === "dev") {
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
    // An invoice event with many lines exceeds Express's 100 kb default; it was refused before its signature was read (D23).
    express.raw({ type: "application/json", limit: "1mb" }),
    require("./routes/stripe-webhook"),
  );
  // Inbound email carries base64 attachments: its own, larger JSON limit (OCTA-COMM-CONV-042).
  // It is mounted before the NUL guard below, but runs the same check itself
  // (requestHasDisallowed) once the provider is verified: an unauthenticated
  // caller gets 401 first, a verified payload with a NUL or a lone surrogate
  // 400 — never the 500 a provider would retry (CERT-2).
  app.use(
    "/api/v1/public/inbound-email",
    express.json({ limit: "40mb" }),
    express.urlencoded({ extended: true, limit: "40mb" }),
    require("./routes/inbound-email-webhook"),
  );
  app.use(express.json({ limit: "10mb" }));
  // A NUL (U+0000) in any field reaches Postgres and answers 500 (22P05); a
  // lone UTF-16 surrogate fails in the query engine (InvalidArg). No client
  // sends either, so the whole request is refused here (CERT-2). A multipart
  // body is parsed inside its route, which runs the guard again after multer.
  app.use(rejectNullBytes);

  app.use("/api/health", createHealthRouter({ release }));

  // Org-level routers stand behind the membership gate (architecture doc
  // §2.3): a workspace-bound token, and for these a member rather than a
  // guest — a party member reaches their projects through the project tree
  // and nothing company-wide. Person-level routers (notifications, tasks,
  // search, workflow inbox, conversations, assistant, config) are not gated
  // here: a guest has work of their own in them, scoped by the services.
  // The integrations router carries the gate itself: its accounting OAuth
  // callback is public (the provider redirects the browser to it with no
  // bearer), so the gate has to land after that route, inside the router.
  const membersOnly = requireOrganizationMembership({ kind: "member" });

  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/organisations", require("./routes/organisations"));
  app.use("/api/v1/projects", projectRoutes);
  app.use("/api/v1/companies", membersOnly, companyRoutes);
  app.use("/api/v1/users", membersOnly, userRoutes);
  app.use("/api/v1/config", configRoutes);
  app.use("/api/v1/billing", membersOnly, billingRoutes);
  app.use("/api/v1/notifications", notificationRoutes);
  app.use("/api/v1/tasks", taskRoutes);
  app.use("/api/v1/search", searchRoutes);
  app.use("/api/v1/permissions", membersOnly, permissionRoutes);
  app.use("/api/v1/company", membersOnly, companyWorkspaceRoutes);
  app.use("/api/v1/inventory", membersOnly, require("./routes/inventory"));
  app.use("/api/v1/reports", membersOnly, reportBuilderRoutes);
  app.use("/api/v1/portfolio", membersOnly, portfolioRoutes);
  app.use("/api/v1/workflows", workflowInboxRoutes);
  app.use("/api/v1/integrations", require("./routes/integrations"));
  app.use("/api/v1/company", membersOnly, require("./routes/company-security"));
  app.use("/api/v1/public/bids", require("./routes/bid-portal"));
  app.use("/api/v1/public/rfqs", require("./routes/rfq-portal"));
  app.use("/api/v1/assistant", require("./routes/assistant").orgRouter);
  app.use("/api/v1/conversations", require("./routes/conversations"));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
