export function configureTrustedProxy(app) {
  // Production traffic reaches Express through the loopback-bound Nginx proxy.
  // Trust only that local hop so req.ip resolves the real client address from
  // X-Forwarded-For without accepting spoofed forwarding headers from clients.
  app.set('trust proxy', 'loopback');
}
