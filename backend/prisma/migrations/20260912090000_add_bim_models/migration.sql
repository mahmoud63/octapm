-- OCTA-BIM-IFC-043: IFC models, their elements and the links to the rest of the project.

CREATE TABLE "BimModel" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "discipline" TEXT,
  "documentId" TEXT,
  "ifcSchema" TEXT,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "version" INTEGER NOT NULL DEFAULT 1,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "supersededById" TEXT,
  "ifcProjectName" TEXT,
  "siteName" TEXT,
  "buildingName" TEXT,
  "unitsJson" JSONB NOT NULL DEFAULT '{}',
  "headerJson" JSONB NOT NULL DEFAULT '{}',
  "spatialJson" JSONB NOT NULL DEFAULT '[]',
  "warningsJson" JSONB NOT NULL DEFAULT '[]',
  "typeSummaryJson" JSONB NOT NULL DEFAULT '[]',
  "elementCount" INTEGER NOT NULL DEFAULT 0,
  "entityCount" INTEGER NOT NULL DEFAULT 0,
  "storeyCount" INTEGER NOT NULL DEFAULT 0,
  "linkedCount" INTEGER NOT NULL DEFAULT 0,
  "parsedAt" TIMESTAMP(3),
  "jobId" TEXT,
  "error" TEXT,
  "notes" TEXT,
  "uploadedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BimModel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BimModel_projectId_name_version_key" ON "BimModel"("projectId", "name", "version");
CREATE INDEX "BimModel_orgId_idx" ON "BimModel"("orgId");
CREATE INDEX "BimModel_projectId_status_idx" ON "BimModel"("projectId", "status");
CREATE INDEX "BimModel_projectId_isCurrent_idx" ON "BimModel"("projectId", "isCurrent");
ALTER TABLE "BimModel"
  ADD CONSTRAINT "BimModel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BimModel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BimModel_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BimElement" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "globalId" TEXT NOT NULL,
  "ifcType" TEXT NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "objectType" TEXT,
  "predefinedType" TEXT,
  "tag" TEXT,
  "typeName" TEXT,
  "storeyName" TEXT,
  "storeyGlobalId" TEXT,
  "elevation" DOUBLE PRECISION,
  "spatialPath" TEXT,
  "materialsJson" JSONB NOT NULL DEFAULT '[]',
  "propertiesJson" JSONB NOT NULL DEFAULT '{}',
  "netVolume" DOUBLE PRECISION,
  "grossVolume" DOUBLE PRECISION,
  "netArea" DOUBLE PRECISION,
  "grossArea" DOUBLE PRECISION,
  "length" DOUBLE PRECISION,
  "width" DOUBLE PRECISION,
  "height" DOUBLE PRECISION,
  "perimeter" DOUBLE PRECISION,
  "weight" DOUBLE PRECISION,
  "quantityCount" DOUBLE PRECISION,
  "searchText" TEXT,
  "linkCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BimElement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BimElement_modelId_globalId_key" ON "BimElement"("modelId", "globalId");
CREATE INDEX "BimElement_orgId_idx" ON "BimElement"("orgId");
CREATE INDEX "BimElement_modelId_ifcType_idx" ON "BimElement"("modelId", "ifcType");
CREATE INDEX "BimElement_modelId_storeyGlobalId_idx" ON "BimElement"("modelId", "storeyGlobalId");
CREATE INDEX "BimElement_projectId_ifcType_idx" ON "BimElement"("projectId", "ifcType");
CREATE INDEX "BimElement_projectId_globalId_idx" ON "BimElement"("projectId", "globalId");
ALTER TABLE "BimElement"
  ADD CONSTRAINT "BimElement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BimElement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BimElement_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "BimModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BimElementLink" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "elementId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL DEFAULT 'represents',
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BimElementLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BimElementLink_elementId_recordType_recordId_key" ON "BimElementLink"("elementId", "recordType", "recordId");
CREATE INDEX "BimElementLink_orgId_idx" ON "BimElementLink"("orgId");
CREATE INDEX "BimElementLink_projectId_recordType_recordId_idx" ON "BimElementLink"("projectId", "recordType", "recordId");
CREATE INDEX "BimElementLink_modelId_recordType_idx" ON "BimElementLink"("modelId", "recordType");
ALTER TABLE "BimElementLink"
  ADD CONSTRAINT "BimElementLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BimElementLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BimElementLink_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "BimModel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BimElementLink_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "BimElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
