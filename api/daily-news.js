// /api/daily-news.js
export default async function handler(req, res) {
  const allowedOrigins = [
    "https://little-plans-a950d2.webflow.io",
    "https://www.childcarecentredesktop.com.au"
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Only POST requests allowed" });
  }

  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ error: "Missing daily news content" });
  }

  const userMessage = `
You are an experienced early childhood educator in Australia. Based on the notes below, write a short and natural-sounding "Daily News" story to be shared with families.

Your tone should be warm, professional, and engaging. Avoid exaggeration or made-up detail. Base everything strictly on what is written. Group activities, sensory experiences, creativity, play-based learning, and social interaction are often featured. 

Use simple paragraph structure and natural language — no bullet points, headings, or markdown. Write 3–4 short paragraphs. Begin with a cheerful greeting or contextual opener. Wrap up with a warm closing line like "We look forward to another great day tomorrow!" or a sign-off from educators.

**Notes:**
${content}
`;

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert early childhood educator. Write warm, clear, parent-friendly daily summaries in paragraph form with no markdown."
          },
          {
            role: "user",
            content: userMessage
          }
        ],
        temperature: 0.7,
        max_tokens: 1200
      })
    });

    const data = await openaiRes.json();

    if (!data.choices || !data.choices[0]?.message?.content) {
      console.error("Invalid OpenAI response:", data);
      return res.status(500).json({ message: "OpenAI response missing" });
    }

    return res.status(200).json({ text: data.choices[0].message.content.trim() });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", details: error.message });
  }
}
