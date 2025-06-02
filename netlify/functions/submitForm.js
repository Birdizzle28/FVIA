try {
  const data = JSON.parse(event.body);
  const { name, email, phone, message } = data;

  if (!name || !email || !message) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing required fields" })
    };
  }

  const { error } = await supabase
    .from('submissions')
    .insert([{
      name: String(name || '').trim(),
      email: String(email || '').trim(),
      phone: String(phone || '').trim(),
      message: String(message || '').trim()
    }]);

  if (error) {
    console.error("Supabase error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true })
  };
} catch (err) {
  console.error("Handler error:", err); // 👈 this will show in Netlify logs
  return {
    statusCode: 500,
    body: JSON.stringify({
      error: "Server error",
      details: err.message
    })
  };
}
