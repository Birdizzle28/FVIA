const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: process.env.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,
});
const openai = new OpenAIApi(configuration);

exports.handler = async function (event) {
  const body = JSON.parse(event.body);
  const prompt = body.prompt;

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4o", // or "gpt-3.5-turbo"
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
