// CloudFront viewer-request function for the web build (default behaviour only;
// /api/* and /socket.io/* never pass through it). A path without a file name
// or extension is a client-side route: serve index.html.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri += 'index.html';
  } else if (!uri.includes('.')) {
    request.uri = '/index.html';
  }
  return request;
}
