'use strict';

const net = require('node:net');

const listenHost = '0.0.0.0';
// Keep outside this host's Windows dynamic range (1024–15000): Hyper-V
// can reserve ports in that range after reboot and prevent the bridge starting.
const listenPort = Number(process.env.ALBINAA_ORACLE_BRIDGE_PORT || 23018);
const targetHost = '127.0.0.1';
// The persistent SELECT-only Oracle Read API listens on 3011. 13013 was an
// obsolete pilot port and made catalog loading fail again after every bridge
// restart because the scheduled task did not inherit an override.
const targetPort = Number(process.env.ALBINAA_ORACLE_TARGET_PORT || 3011);

function normalizedAddress(value) {
  return String(value || '').replace(/^::ffff:/, '');
}

function loopbackOnly(socket) {
  const address = normalizedAddress(socket.remoteAddress);
  return address === '127.0.0.1' || address === '::1';
}

const server = net.createServer((client) => {
  if (!loopbackOnly(client)) {
    console.warn(`Rejected non-loopback bridge client: ${client.remoteAddress || 'unknown'}`);
    client.destroy();
    return;
  }

  const upstream = net.connect({ host: targetHost, port: targetPort });
  const closeBoth = () => {
    if (!client.destroyed) client.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };

  client.setTimeout(30_000, closeBoth);
  upstream.setTimeout(30_000, closeBoth);
  client.on('error', closeBoth);
  upstream.on('error', closeBoth);
  client.pipe(upstream);
  upstream.pipe(client);
});

server.on('error', (error) => {
  console.error(`Oracle Docker bridge failed: ${error.message}`);
  process.exitCode = 1;
});

server.listen(listenPort, listenHost, () => {
  console.log(`Oracle Docker bridge listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
