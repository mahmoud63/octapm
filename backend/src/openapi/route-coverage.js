const getLayerMountPath = (layer) => {
  let source = layer.regexp.source;
  if (source === '^\\/?(?=\\/|$)') return '';

  source = source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\/\?\$$/, '')
    .replace(/\\\//g, '/');

  let keyIndex = 0;
  source = source
    .replace(/\(\?:\/\(\[\^\/\]\+\?\)\)/g, () => {
      const key = layer.keys[keyIndex++]?.name || 'param';
      return `/{${key}}`;
    })
    .replace(/\(\[\^\/\]\+\?\)/g, () => {
      const key = layer.keys[keyIndex++]?.name || 'param';
      return `{${key}}`;
    })
    .replace(/\\\./g, '.')
    .replace(/\^/g, '')
    .replace(/\$/g, '')
    .replace(/\?/g, '');

  return source;
};

const normalizeExpressPath = (path) =>
  (path
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '') || '/');

const operationShape = (method, path) =>
  `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`;

const collectExpressRoutes = (app) => {
  const routes = [];

  const walk = (stack, prefix = '') => {
    for (const layer of stack) {
      if (layer.route) {
        const path = normalizeExpressPath(`${prefix}${layer.route.path}`);
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ method, path });
        }
        continue;
      }

      if (layer.name === 'router' && layer.handle?.stack) {
        walk(
          layer.handle.stack,
          normalizeExpressPath(`${prefix}${getLayerMountPath(layer)}`),
        );
      }
    }
  };

  walk(app._router.stack);
  return routes;
};

const collectVersionedApiRouteShapes = (app) =>
  [
    ...new Set(
      collectExpressRoutes(app)
        .filter(
          ({ path }) =>
            path.startsWith('/api/v1') &&
            path !== '/api/v1/openapi.json' &&
            !path.startsWith('/api/v1/docs'),
        )
        .map(({ method, path }) =>
          operationShape(method, path.replace('/api/v1', '') || '/'),
        ),
    ),
  ].sort();

const collectOpenApiOperationShapes = (openApiSpec) => {
  const shapes = [];
  for (const [path, methods] of Object.entries(openApiSpec.paths)) {
    for (const method of Object.keys(methods)) {
      shapes.push(operationShape(method, path));
    }
  }
  return [...new Set(shapes)].sort();
};

const findUndocumentedVersionedApiRoutes = (app, openApiSpec) => {
  const documented = new Set(collectOpenApiOperationShapes(openApiSpec));
  return collectVersionedApiRouteShapes(app).filter(
    (route) => !documented.has(route),
  );
};

module.exports = {
  collectOpenApiOperationShapes,
  collectVersionedApiRouteShapes,
  findUndocumentedVersionedApiRoutes,
  operationShape,
};
