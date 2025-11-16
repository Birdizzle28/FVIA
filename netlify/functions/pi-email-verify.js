export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Use POST" }) };
  }

  try {
    const { code, expected } = JSON.parse(event.body);

    if (!code || !expected) {
      return { statusCode: 400, body: JSON.stringify({ error: "Code missing" }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: code === expected
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
}
