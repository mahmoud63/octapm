# syntax=docker/dockerfile:1.7
#
# The OctaPM API and worker: one image, two commands.
#
#   docker build -f backend/Dockerfile \
#     --build-arg RELEASE_GIT_SHA=$(git rev-parse HEAD) \
#     --build-arg RELEASE_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
#     -t octapm-api .
#
# The build context is the repository root, because the backend installs from
# the root package-lock.json (backend/package-lock.json is stale and is never
# used) and requires shared/permissions.json at run time.
#
#   API service     default CMD                   node src/index.js
#   worker service  command ["node","src/worker.js"]
#   migrations      one-off task: npx prisma migrate deploy   (never at start)
#   staging E2E     one-off task: node scripts/e2e/reset-e2e-org.js, with
#                   ALLOW_DATA_SCRIPT=<host>/<db> (the data-script guard)
#
# ECS ignores HEALTHCHECK; the ALB target group checks /api/health itself. It is
# here for `docker run` and the CI proof.

# node:24.14.0 because package.json engines require >=24.14.0 <25 and .nvmrc
# pins 24.14.0. Pin by digest once the registry is chosen.
ARG NODE_IMAGE=node:24.14.0-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps

# Prisma picks its engine by the OpenSSL it finds; without the package, slim
# images look like openssl-1.1 and load an engine that cannot start.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV CHECKPOINT_DISABLE=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

WORKDIR /app

# Only the manifests first, so a source change does not reinstall.
# frontend/package.json is deliberately absent: with it npm reports the
# frontend's packages as extraneous; without it only the backend installs.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json

# Production dependencies of the backend workspace only. prisma is a runtime
# dependency (the migrate one-off uses its CLI), so --omit=dev keeps it.
RUN npm ci --omit=dev --workspace=backend \
  && mkdir -p backend/node_modules \
  && npm cache clean --force

# Generated here, on the same Debian and OpenSSL as the runtime stage, so the
# default "native" engine target is the right one.
COPY backend/prisma/schema.prisma backend/prisma/schema.prisma
RUN node node_modules/prisma/build/index.js generate --schema backend/prisma/schema.prisma

# ---------------------------------------------------------------------------
# The database CA: one root out of the public RDS bundle.
#
# DATABASE_URL carries sslmode=require&sslcert=/app/certs/rds-ca.pem&
# sslaccept=strict. Prisma reads only the FIRST certificate of that file (and
# without sslaccept=strict verifies nothing at all), so the global bundle as
# downloaded would make Prisma trust whichever region's root comes first and
# refuse the real server. The file must hold exactly the root the RDS
# instance's CA chains to: set RDS_CA_CN to match the instance's
# --ca-certificate-identifier and region (rds-ca-rsa2048-g1 in us-east-2 is
# "Amazon RDS us-east-2 Root CA RSA2048 G1"). The picker fails the build when
# the bundle has no such root, or it has expired.
FROM ${NODE_IMAGE} AS rds-ca
ARG RDS_CA_CN="Amazon RDS us-east-2 Root CA RSA2048 G1"
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /tmp/rds-global-bundle.pem
COPY backend/docker/pick-rds-ca.cjs /tmp/pick-rds-ca.cjs
RUN node /tmp/pick-rds-ca.cjs /tmp/rds-global-bundle.pem "${RDS_CA_CN}" > /tmp/rds-ca.pem

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=5000 \
    CHECKPOINT_DISABLE=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# The one RDS root picked above. Owned by root and world-readable: the node
# user has to read it and must not be able to replace it.
COPY --from=rds-ca --chown=root:root --chmod=0644 /tmp/rds-ca.pem /app/certs/rds-ca.pem

WORKDIR /app

# Everything below is owned by root and only readable by the node user: the
# app writes nothing under /app (uploads go to os.tmpdir()), so a stray write
# fails instead of silently landing in a container layer.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY package.json ./
COPY shared ./shared
COPY backend/package.json ./backend/package.json
COPY backend/prisma ./backend/prisma
COPY backend/src ./backend/src
# The guarded E2E reset runs as a one-off task inside the VPC for staging E2E.
# The rest of backend/scripts (QA, demo, phase harnesses) stays out.
COPY backend/scripts/e2e ./backend/scripts/e2e

WORKDIR /app/backend

# Release identity, read by the API's X-OctaPM-Release header and required in
# production (40 hex characters). Declared late so a new commit reuses every
# layer above.
ARG RELEASE_GIT_SHA=""
ARG RELEASE_BUILD_TIME=""
ENV RELEASE_GIT_SHA=${RELEASE_GIT_SHA} \
    RELEASE_BUILD_TIME=${RELEASE_BUILD_TIME}
LABEL org.opencontainers.image.source="https://github.com/mahmoud63/octapm" \
      org.opencontainers.image.revision="${RELEASE_GIT_SHA}" \
      org.opencontainers.image.created="${RELEASE_BUILD_TIME}"

USER node

EXPOSE 5000

# There is no curl in the slim image; node's fetch does the same job.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Exec form: node is PID 1 and receives SIGTERM from `docker stop` / ECS
# directly. A shell in between would swallow it and the task would be killed
# at the stop timeout instead of draining.
CMD ["node", "src/index.js"]
