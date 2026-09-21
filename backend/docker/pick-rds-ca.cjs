#!/usr/bin/env node
/**
 * Picks the one CA certificate the database connection should trust out of a
 * multi-certificate PEM bundle, and prints it.
 *
 *   node pick-rds-ca.cjs <bundle.pem> "<subject CN>" > rds-ca.pem
 *
 * Why a single certificate: Prisma's query and schema engines load the file
 * named by DATABASE_URL's sslcert with a single-certificate PEM reader, so
 * they trust only the FIRST certificate in it. Handed the RDS global bundle
 * (every region's roots), Prisma with sslaccept=strict trusts whichever root
 * happens to come first and refuses the real server; without sslaccept=strict
 * it trusts anything, because Prisma's default is accept_invalid_certs. The
 * only file that verifies the server for Prisma is one that holds exactly the
 * root the RDS instance's CA (--ca-certificate-identifier) chains to.
 * node-postgres reads a bundle properly, so the realtime adapter is just as
 * happy with the same one-root file.
 *
 * Runs at image build time (backend/Dockerfile, stage rds-ca). It fails the
 * build rather than print something that would connect to nothing: no match,
 * more than one match, a certificate that is not a CA, or one that has expired.
 */
const crypto = require("crypto");
const fs = require("fs");

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

const commonName = (cert) => {
  const line = cert.subject.split("\n").find((part) => part.startsWith("CN="));
  return line ? line.slice(3) : "";
};

const pick = (bundleText, wantedCn, now = new Date()) => {
  const blocks = bundleText.match(PEM_BLOCK) || [];
  if (blocks.length === 0) throw new Error("the bundle holds no PEM certificates");
  const certs = blocks.map((pem) => ({ pem, cert: new crypto.X509Certificate(pem) }));
  const matches = certs.filter(({ cert }) => commonName(cert) === wantedCn);
  if (matches.length !== 1) {
    const names = [...new Set(certs.map(({ cert }) => commonName(cert)))].sort();
    throw new Error(
      `expected exactly one certificate with CN "${wantedCn}", found ${matches.length}. ` +
        `The bundle holds ${certs.length} certificates:\n  ${names.join("\n  ")}`,
    );
  }
  const [{ pem, cert }] = matches;
  if (!cert.ca) throw new Error(`"${wantedCn}" is not a CA certificate`);
  if (new Date(cert.validTo) <= now) throw new Error(`"${wantedCn}" expired on ${cert.validTo}`);
  return `${pem}\n`;
};

if (require.main === module) {
  const [bundlePath, wantedCn] = process.argv.slice(2);
  if (!bundlePath || !wantedCn) {
    console.error('usage: node pick-rds-ca.cjs <bundle.pem> "<subject CN>"');
    process.exit(2);
  }
  try {
    process.stdout.write(pick(fs.readFileSync(bundlePath, "utf8"), wantedCn));
  } catch (error) {
    console.error(`pick-rds-ca: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { pick, commonName };
