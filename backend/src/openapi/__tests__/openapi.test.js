const request = require('supertest');
const SwaggerParser = require('@apidevtools/swagger-parser');
const { createApp } = require('../../app');
const { openApiSpec } = require('../spec');
const {
  collectOpenApiOperationShapes,
  collectVersionedApiRouteShapes,
  findUndocumentedVersionedApiRoutes,
} = require('../route-coverage');

describe('OpenAPI documentation', () => {
  it('validates as an OpenAPI document', async () => {
    await expect(
      SwaggerParser.validate(JSON.parse(JSON.stringify(openApiSpec))),
    ).resolves.toBeTruthy();
  });

  it('serves the OpenAPI JSON contract locally', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/openapi.json').expect(200);

    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('PMcopilots API');
    expect(res.body.paths['/auth/login'].post).toBeDefined();
    expect(res.body.paths['/projects/{projectId}/boq/upload'].post.requestBody.content['multipart/form-data']).toBeDefined();
  });

  it('serves Swagger UI for API consumers', async () => {
    const app = createApp();
    const res = await request(app).get('/api/docs/').expect(200);
    const versioned = await request(app).get('/api/v1/docs/').expect(200);
    const init = await request(app).get('/api/docs/swagger-ui-init.js').expect(200);
    const versionedInit = await request(app).get('/api/v1/docs/swagger-ui-init.js').expect(200);

    expect(res.text).toContain('PMcopilots API Docs');
    expect(res.text).toContain('swagger-ui');
    expect(versioned.text).toContain('PMcopilots API Docs');
    expect(versioned.text).toContain('swagger-ui');
    expect(init.text).toContain('/api/v1/openapi.json');
    expect(versionedInit.text).toContain('/api/v1/openapi.json');
  });

  it('documents every live versioned API route shape', () => {
    const app = createApp();
    const documentedShapes = collectOpenApiOperationShapes(openApiSpec);
    const liveRouteShapes = collectVersionedApiRouteShapes(app);

    expect(documentedShapes).toEqual(
      expect.arrayContaining(liveRouteShapes),
    );

    expect(findUndocumentedVersionedApiRoutes(app, openApiSpec)).toEqual([]);
  });

  it('smoke tests documented protected routes with the error envelope', async () => {
    const app = createApp();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      for (const [method, path] of [
        ['get', '/api/v1/auth/me'],
        ['get', '/api/v1/projects/00000000-0000-4000-8000-000000000001/schedule'],
        ['post', '/api/v1/projects/00000000-0000-4000-8000-000000000001/boq/upload'],
      ]) {
        const res = await request(app)[method](path).expect(401);

        expect(res.body).toMatchObject({
          success: false,
          error: { code: 'AUTH_REQUIRED' },
        });
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('documents core endpoint params, responses, and permissions', () => {
    const schedule = openApiSpec.paths['/projects/{projectId}/schedule'].get;
    const progress = openApiSpec.paths['/projects/{projectId}/activities/{id}/progress'].post;
    const exportXlsx = openApiSpec.paths['/projects/{projectId}/export/xlsx'].get;

    expect(schedule.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'projectId', in: 'path', required: true }),
      ]),
    );
    expect(schedule['x-permissions']).toMatchObject({
      module: 'schedule',
      action: 'read',
    });
    expect(progress.requestBody.content['application/json']).toBeDefined();
    expect(progress.responses[400].content['application/json'].schema.$ref).toBe('#/components/schemas/ErrorEnvelope');
    expect(exportXlsx.responses[200].content['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']).toBeDefined();
  });
});
