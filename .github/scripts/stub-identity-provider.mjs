/**
 * Stands in for oauth2-proxy so the proxy's identity handling can be tested
 * without a real OAuth provider. Answers the forward-auth probe as a signed-in
 * session belonging to `real-user`, which is the identity the app should end up
 * seeing no matter what the client claimed.
 */
import { createServer } from "node:http";

createServer((request, response) => {
  if (request.url.startsWith("/oauth2/auth")) {
    response.writeHead(202, {
      "X-Auth-Request-User": "real-user",
      "X-Auth-Request-Email": "real@example.test",
    });
    return response.end();
  }
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("sign-in page");
}).listen(4180, "127.0.0.1");
