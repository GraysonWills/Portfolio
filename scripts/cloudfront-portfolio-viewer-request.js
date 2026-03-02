function serializeQueryString(querystring) {
  if (!querystring) return "";
  var pairs = [];
  for (var key in querystring) {
    if (!Object.prototype.hasOwnProperty.call(querystring, key)) continue;
    var entry = querystring[key];
    if (!entry) {
      pairs.push(key);
      continue;
    }
    if (entry.multiValue && entry.multiValue.length) {
      for (var i = 0; i < entry.multiValue.length; i++) {
        var mv = entry.multiValue[i];
        if (!mv || mv.value === undefined || mv.value === null || mv.value === "") {
          pairs.push(key);
        } else {
          pairs.push(key + "=" + mv.value);
        }
      }
      continue;
    }
    if (entry.value === undefined || entry.value === null || entry.value === "") {
      pairs.push(key);
    } else {
      pairs.push(key + "=" + entry.value);
    }
  }
  return pairs.length ? "?" + pairs.join("&") : "";
}

function handler(event) {
  var request = event.request;
  var uri = request.uri || "/";
  var method = (request.method || "GET").toUpperCase();
  var hostHeader = request.headers && request.headers.host;
  var host = hostHeader && hostHeader.value ? hostHeader.value.toLowerCase() : "";

  // Enforce canonical host for SEO + cache consistency.
  if (host === "grayson-wills.com") {
    var target = "https://www.grayson-wills.com" + uri + serializeQueryString(request.querystring);
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: { value: target },
        "cache-control": { value: "public, max-age=300" }
      }
    };
  }

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
