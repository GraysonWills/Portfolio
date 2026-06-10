/**
 * Browser polyfills for Node-oriented libraries.
 *
 * `amazon-cognito-identity-js` expects a Node-like global object in dev builds.
 */

(window as any).global = window;

export {};
