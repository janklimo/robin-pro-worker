interface Env {
  R2: R2Bucket;
  AWS_HOSTNAME: string;
}

const objectNotFound = (objectName: string): Response =>
  new Response(`Object ${objectName} not found`, {
    status: 404,
  });

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: EventContext<any, any, any>,
  ): Promise<Response> {
    const url = new URL(request.url);
    const objectName = url.pathname.slice(1);

    if (objectName === "") {
      return new Response(`Bad Request`, {
        status: 400,
      });
    }

    if (request.method !== "GET") {
      return new Response(`Method Not Allowed`, {
        status: 405,
      });
    }

    const obj = await env.R2.get(objectName);

    /**
     * An object can be fetched successfully but the write somehow fail
     * ending up with an object of size 0. If that happens, refetch and
     * attempt to save it until it succeeds.
     */
    if (obj === null || obj.size === 0) {
      url.protocol = "https:";
      url.hostname = env.AWS_HOSTNAME;

      console.log("Fetching:", url.toString());

      const s3Object = await fetch(url.toString());

      if (s3Object.status === 403 || s3Object.status === 404) {
        return objectNotFound(objectName);
      }

      const s3Body = s3Object.body!.tee();
      ctx.waitUntil(
        env.R2.put(objectName, s3Body[0], {
          httpMetadata: s3Object.headers,
        }),
      );

      return new Response(s3Body[1], s3Object);
    }

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);

    return new Response(obj.body, {
      headers,
    });
  },
};
