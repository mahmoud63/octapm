'use strict';

/**
 * The product's Express application, in this process, on the certification
 * database — for proofs that must exercise the code in the working tree
 * (a mutation proof changes a file and runs the proof again; a server started
 * earlier would still run the old code).
 *
 *   const { app, as, prisma, close } = await require('./lib/inprocess').start();
 *   const res = await as('pm@c022.octapm-cert.test').send('POST', '/inventory/warehouses', {...});
 *
 * Nothing listens on a port. The database is proven by the certification
 * guard before the application is loaded; schedulers and the worker are off.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const guard = require('./cert-env');

const start = async () => {
  process.env.DATABASE_URL = guard.certDatabaseUrl();
  process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'development' : process.env.NODE_ENV || 'development';
  for (const name of ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED', 'EXCEPTIONS_ENGINE_ENABLED']) process.env[name] = 'false';
  const prisma = await guard.connectCertPrisma();
  // eslint-disable-next-line global-require
  const request = require('supertest');
  // eslint-disable-next-line global-require
  const app = require('../../../src/app').createApp();
  const password = process.env.CERT_PASSWORD;
  if (!password) throw new Error('CERT_PASSWORD is not set.');

  const tokens = new Map();
  const signIn = async (email, orgId = null) => {
    const key = `${email}|${orgId || ''}`;
    if (tokens.has(key)) return tokens.get(key);
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status} ${res.body?.error?.code}`);
    let token = res.body?.data?.tokens?.accessToken;
    if (!token && res.body?.data?.chooseWorkspace) {
      const target = orgId || res.body.data.memberships[0].orgId;
      const chosen = await request(app).post(`/api/v1/auth/workspaces/${target}/session`).set('authorization', `Bearer ${res.body.data.identityToken}`).send({});
      token = chosen.body?.data?.tokens?.accessToken;
    }
    if (!token) throw new Error(`sign-in ${email}: no access token`);
    tokens.set(key, token);
    return token;
  };

  const as = (email, orgId = null) => ({
    send: async (method, route, json) => {
      const token = await signIn(email, orgId);
      let req = request(app)[method.toLowerCase()](`/api/v1${route}`).set('authorization', `Bearer ${token}`);
      if (json !== undefined) req = req.send(json);
      const res = await req;
      return { status: res.status, body: res.body, text: res.text };
    },
  });

  const close = async () => {
    await prisma.$disconnect();
    // eslint-disable-next-line global-require
    await require('../../../src/config/db').prisma.$disconnect().catch(() => {});
  };
  return { app, as, prisma, close };
};

module.exports = { start };
