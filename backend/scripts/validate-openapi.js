const SwaggerParser = require('@apidevtools/swagger-parser');
const { openApiSpec } = require('../src/openapi/spec');
const { createApp } = require('../src/app');
const {
  findUndocumentedVersionedApiRoutes,
} = require('../src/openapi/route-coverage');

const requiredPaths = [
  ['post', '/auth/login'],
  ['post', '/auth/register'],
  ['post', '/auth/refresh'],
  ['post', '/auth/logout'],
  ['get', '/auth/me'],
  ['get', '/projects'],
  ['post', '/projects'],
  ['get', '/projects/{projectId}'],
  ['get', '/projects/{projectId}/boq'],
  ['post', '/projects/{projectId}/boq/upload'],
  ['get', '/projects/{projectId}/schedule'],
  ['post', '/projects/{projectId}/schedule/generate'],
  ['post', '/projects/{projectId}/import/xer'],
  ['post', '/projects/{projectId}/import/p6xml'],
  ['post', '/projects/{projectId}/import/msp'],
  ['get', '/projects/{projectId}/activities'],
  ['post', '/projects/{projectId}/activities/{id}/progress'],
  ['get', '/projects/{projectId}/reports/ev'],
  ['get', '/projects/{projectId}/change-orders'],
  ['get', '/projects/{projectId}/ipc'],
  ['get', '/projects/{projectId}/long-lead'],
  ['get', '/projects/{projectId}/quality/dashboard'],
  ['get', '/projects/{projectId}/doc-control/dashboard'],
  ['post', '/projects/{projectId}/workflow/uploads'],
  ['get', '/projects/{projectId}/export/xlsx'],
];

const uploadPaths = [
  '/projects/{projectId}/boq/upload',
  '/projects/{projectId}/schedule/generate',
  '/projects/{projectId}/import/xer',
  '/projects/{projectId}/import/p6xml',
  '/projects/{projectId}/import/msp',
  '/projects/{projectId}/import/progress',
  '/projects/{projectId}/workflow/uploads',
];

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const getOperation = (method, path) => openApiSpec.paths[path]?.[method];

const validateOperationContract = () => {
  for (const [method, path] of requiredPaths) {
    const op = getOperation(method, path);
    assert(op, `Missing documented operation: ${method.toUpperCase()} ${path}`);
    assert(op.operationId, `Missing operationId: ${method.toUpperCase()} ${path}`);
    assert(op.responses, `Missing responses: ${method.toUpperCase()} ${path}`);
    assert(op['x-permissions'], `Missing x-permissions: ${method.toUpperCase()} ${path}`);
  }

  for (const path of uploadPaths) {
    const op = getOperation('post', path);
    const content = op?.requestBody?.content || {};
    assert(
      content['multipart/form-data'],
      `Upload endpoint must document multipart/form-data: POST ${path}`,
    );
  }

  for (const [path, methods] of Object.entries(openApiSpec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      assert(op.responses?.[400], `Missing 400 error response: ${method.toUpperCase()} ${path}`);
      assert(op.responses?.[500], `Missing 500 error response: ${method.toUpperCase()} ${path}`);
      assert(Array.isArray(op.security), `Missing explicit security array: ${method.toUpperCase()} ${path}`);

      if (!op.security.length) continue;
      if (op.security.some((entry) => entry.refreshCookie)) {
        assert(
          op['x-permissions']?.auth === 'refresh-cookie',
          `Refresh-cookie operation must document refresh-cookie permissions: ${method.toUpperCase()} ${path}`,
        );
        continue;
      }

      assert(
        op.security.some((entry) => entry.bearerAuth),
        `Authenticated operation must use bearerAuth: ${method.toUpperCase()} ${path}`,
      );
      assert(
        op['x-permissions']?.auth === 'bearer',
        `Authenticated operation must document bearer permissions: ${method.toUpperCase()} ${path}`,
      );
      assert(
        Array.isArray(op['x-permissions'].roles),
        `Authenticated operation must document allowed roles: ${method.toUpperCase()} ${path}`,
      );
    }
  }
};

const validateRouteCoverage = () => {
  const missing = findUndocumentedVersionedApiRoutes(createApp(), openApiSpec);
  assert(
    missing.length === 0,
    `Missing OpenAPI operations for live /api/v1 routes:\n${missing.join('\n')}`,
  );
};

const main = async () => {
  await SwaggerParser.validate(JSON.parse(JSON.stringify(openApiSpec)));
  validateOperationContract();
  validateRouteCoverage();
  console.log(
    `OpenAPI validation passed for ${Object.keys(openApiSpec.paths).length} documented paths.`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
