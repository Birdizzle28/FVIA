import webpush from "web-push";

export default async () => {
  const keys = webpush.generateVAPIDKeys();
  return new Response(JSON.stringify(keys), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
