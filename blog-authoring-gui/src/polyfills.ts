/**
 * Browser polyfills for Node-oriented libraries.
 *
 * Some dependencies (notably `amazon-cognito-identity-js`) assume a Node-like
 * `global` object exists. Angular does not polyfill this by default.
 */

// Expose a `global` binding for packages that expect it.
// This must run before the app bundle loads.
(window as any).global = window;

export {};

