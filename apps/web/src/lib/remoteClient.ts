// A paired phone or browser reaching Glade over the network, as opposed to the desktop app, or a
// browser on the same computer, talking to the server on loopback.
export const isRemoteClient =
  window.desktopBridge === undefined &&
  !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
