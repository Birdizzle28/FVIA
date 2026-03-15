import fetch from "node-fetch";

export async function handler() {
  try {

    const username = process.env.NIPR_PROD_USERNAME;
    const password = process.env.NIPR_PROD_PASSWORD;

    const endpoint =
      "https://pdb-services.nipr.com/pdb-alerts-industry-services/industry-ws/receiveSpecificReportForSubscription";

    const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ind="https://pdb-services.nipr.com/pdb-alerts-industry-services/industry-ws">
   <soapenv:Header/>
   <soapenv:Body>
      <ind:receiveSpecificReportForSubscription>
         <ind:subscriptionName>Agents</ind:subscriptionName>
         <ind:reportDate>2026-03-07</ind:reportDate>
      </ind:receiveSpecificReportForSubscription>
   </soapenv:Body>
</soapenv:Envelope>`;

    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "text/xml;charset=UTF-8",
      },
      body: soap,
    });

    const text = await res.text();

    return {
      statusCode: res.status,
      body: JSON.stringify({
        status: res.status,
        raw: text,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message,
      }),
    };
  }
}
