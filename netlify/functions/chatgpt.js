/*const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});*/
const openai = new OpenAIApi(configuration);

exports.handler = async function (event) {
  return {
    statusCode: 200,
    body: JSON.stringify({ response: "🧪 GPT test bypassed. Function works!" }),
  };
};
/*exports.handler = async function (event) {
  const body = JSON.parse(event.body);
  const prompt = body.prompt;

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo", // or "gpt-3.5-turbo"
      messages: [{ role: "user", content: prompt }],
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ response: completion.data.choices[0].message.content }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
*/
