#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');
const selfsigned = require('selfsigned');

const outputDir = process.env.CERT_DIR || path.join(__dirname, '..', 'certs');
const commonName = process.env.CERT_COMMON_NAME || 'localhost';

const run = async () => {
  await fs.mkdir(outputDir, { recursive: true });

  const attrs = [{ name: 'commonName', value: commonName }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256'
  });

  const certPath = path.join(outputDir, 'cert.pem');
  const keyPath = path.join(outputDir, 'key.pem');

  await fs.writeFile(certPath, pems.cert, 'utf8');
  await fs.writeFile(keyPath, pems.private, 'utf8');

  console.log(`Self-signed cert written to ${certPath}`);
  console.log(`Self-signed key written to ${keyPath}`);
};

run().catch((error) => {
  console.error('Failed to generate certs:', error);
  process.exit(1);
});
