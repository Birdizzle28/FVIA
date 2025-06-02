const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { name, email, phone, message } = JSON.parse(event.body);

    const { data, error } = await supabase
      .from('submissions')
      .insert([{ name, email, phone, message }]);

    if (error) {
      console.error('Supabase insert error:', error.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Form submitted successfully', data }),
    };
  } catch (err) {
    console.error('Catch block error:', err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid request body', details: err.message }),
    };
  }
};
