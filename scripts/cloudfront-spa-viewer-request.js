function handler(event) {
  var request = event.request;
  var uri = request.uri || "/";
  var method = (request.method || "GET").toUpperCase();

  if (method !== "GET" && method !== "HEAD") {
    return request;
  }

  // Do not rewrite concrete asset/API paths.
  if (uri.indexOf("/api/") === 0 || uri.indexOf("/assets/") === 0 || uri.indexOf("/uploads/") === 0) {
    return request;
  }
  if (uri.indexOf(".") !== -1) {
    return request;
  }

  // Rewrite extensionless application routes to SPA shell.
  request.uri = "/index.html";
  return request;
}
