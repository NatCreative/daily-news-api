import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://little-plans-a950d2.webflow.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Only POST requests allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Unauthorized: No token provided' });

  // ✅ Use fetch to validate JWT on the server
  const authResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });

  if (!authResponse.ok) {
    console.error('Auth error:', await authResponse.text());
    return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
  }

  const user = await authResponse.json();

  const { data: userRecord, error: userFetchError } = await supabase
    .from('user_profiles')
    .select('generations, tier, room_name')
    .eq('id', user.id)
    .single();

  if (userFetchError || !userRecord) {
    console.error('User fetch error:', userFetchError);
    return res.status(500).json({ message: 'User record not found or database error', details: userFetchError?.message });
  }

  if (userRecord.tier === 'Free' && userRecord.generations >= 10) {
    console.log(`User ${user.id} has reached the free limit.`);
    return res.status(403).json({ message: 'You have reached your free limit of 10 generations this month. Upgrade to continue.' });
  }

  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ message: 'Content is required' });
  }

  const inappropriate = /(sex|violence|drugs|abuse|nudity|suicide|murder|killing)/i;
  if (inappropriate.test(content)) {
    console.warn(`Inappropriate request detected from user ${user.id}.`);
    return res.status(400).json({ message: 'This request falls outside the scope of early childhood education.' });
  }

  const roomName = userRecord.room_name || 'the room';

  const userPrompt = `
You are an experienced early childhood educator in Australia. Based on the notes below, write a short and natural-sounding "Daily News" story to be shared with families.
Your tone should be warm, professional, and engaging. Avoid exaggeration or made-up detail. Base everything strictly on what is written. Group activities, sensory experiences, creativity, play-based learning, and social interaction are often featured.
Use simple paragraph structure and natural language — no bullet points, headings, or markdown. Write 3–4 short paragraphs, aiming for approximately 150-200 words.
Notes:
${content}
Room: ${roomName}
Please include:

Begin with a warm greeting or contextual reference (e.g., acknowledging recent events, holidays, or the day/week)
A paragraph-style summary of the day, using British English spelling and terminology
Simple, family-friendly language with early childhood development phrases that highlight learning outcomes (e.g., 'sparked curiosity,' 'confidence grew,' 'engaging their senses')
No fictional details – only summarise what is inferred from the captions/notes
Highlight learning, social connection, and play
Mention the Room Name in the response e.g. "Today in the ${roomName} room..."
Close with a warm ending and include educator names in the sign-off or if educator names are not provided add "[add present educator names here]"

Write like a real educator communicating to parents, using friendly and professional tone. Structure should flow naturally from opener → main activities → learning highlights → warm closing with educator names.
`; 

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Project': 'proj_ok4p8YSgjhmqm16Xtu8HUWag'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You write daily news updates for early learning centres. Keep it warm, accurate, and concise.' },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (!data.choices || !data.choices[0]?.message?.content) {
      console.error('Invalid OpenAI response:', data);
      return res.status(500).json({ message: 'OpenAI response missing or invalid.' });
    }

const cleanedText = data.choices[0].message.content.trim();


    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ generations: userRecord.generations + 1 })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating generations:', updateError);
      return res.status(500).json({ message: 'Failed to update usage count.', details: updateError?.message });
    }

    console.log(`Daily News generated for user ${user.id}. Generations now ${userRecord.generations + 1}`);

    return res.status(200).json({ text: cleanedText });
  } catch (error) {
    console.error('Unhandled server error:', error);
    return res.status(500).json({ message: 'Server error', details: error.message });
  }
}
