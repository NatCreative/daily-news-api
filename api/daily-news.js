import { createClient } from '@supabase/supabase-js';

// ✅ FIXED: Use ANON key for JWT verification, not service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY  // ✅ Changed from SERVICE_ROLE_KEY to ANON_KEY
);

export default async function handler(req, res) {
  // ✅ Updated CORS to allow your domain and any localhost for testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Only POST requests allowed' });

  try {
    // ✅ Enhanced token extraction and validation
    const authHeader = req.headers.authorization;
    console.log('Auth header present:', !!authHeader);
    console.log('Auth header value:', authHeader ? authHeader.substring(0, 20) + '...' : 'None');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('Invalid authorization header format');
      return res.status(401).json({ message: 'Unauthorized: Invalid authorization header format' });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      console.error('Empty token after extraction');
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    console.log('Token extracted, length:', token.length);

    // ✅ FIXED: Verify user with JWT token using anon key
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError) {
      console.error('Supabase auth error:', authError);
      return res.status(401).json({ 
        message: 'Unauthorized: Token validation failed', 
        details: authError.message 
      });
    }
    
    if (!user) {
      console.error('No user returned from token');
      return res.status(401).json({ message: 'Unauthorized: Invalid token' });
    }

    console.log('User authenticated:', user.id);

    // ✅ Create service client for database operations (if needed for admin operations)
    const serviceSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ✅ Fetch user profile using regular client (RLS will handle permissions)
    const { data: userRecord, error: userFetchError } = await supabase
      .from('user_profiles')
      .select('generations, tier, room_name')
      .eq('id', user.id)
      .single();

    if (userFetchError) {
      console.error('User fetch error:', userFetchError);
      return res.status(500).json({ 
        message: 'User record not found or database error', 
        details: userFetchError?.message 
      });
    }

    if (!userRecord) {
      console.error('No user record found for user:', user.id);
      return res.status(404).json({ message: 'User profile not found' });
    }

    // ✅ Check generation limits
    if (userRecord.tier === 'Free' && userRecord.generations >= 10) {
      console.log(`User ${user.id} has reached the free limit.`);
      return res.status(403).json({ 
        message: 'You have reached your free limit of 10 generations this month. Upgrade to continue.' 
      });
    }

    // ✅ Extract content from request body
    const { content, photoCaptions, additionalNotes } = req.body;
    
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Content received:', !!content);

    if (!content) {
      console.error('No content provided in request body');
      return res.status(400).json({ message: 'Content is required' });
    }

    // ✅ Content filtering
    const inappropriate = /(sex|violence|drugs|abuse|nudity|suicide|murder|killing)/i;
    const contentToCheck = (content || '') + (photoCaptions || '') + (additionalNotes || '');
    
    if (inappropriate.test(contentToCheck)) {
      console.warn(`Inappropriate request detected from user ${user.id}.`);
      return res.status(400).json({ 
        message: 'This request falls outside the scope of early childhood education.' 
      });
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

    // ✅ OpenAI API call
    console.log('Making OpenAI API request...');
    
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

    if (!response.ok) {
      console.error('OpenAI API error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('OpenAI error details:', errorText);
      return res.status(500).json({ 
        message: 'OpenAI API error', 
        details: `${response.status}: ${response.statusText}` 
      });
    }

    const data = await response.json();
    console.log('OpenAI response received');

    if (!data.choices || !data.choices[0]?.message?.content) {
      console.error('Invalid OpenAI response structure:', data);
      return res.status(500).json({ message: 'OpenAI response missing or invalid.' });
    }

    const rawText = data.choices[0].message.content.trim();
    
    // ✅ Text cleaning
    const cleanedText = rawText
      .replace(/^(#+\s?.+)$/gm, '\n\n$1\n\n')
      .replace(/^\s*[-*+]\s*$/gm, '')
      .replace(/^\s*[-*+]\s*\n/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([^\n])\n([^\n])/g, '$1\n\n$2');

    // ✅ Update generation count using regular client (RLS will handle permissions)
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ generations: userRecord.generations + 1 })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating generations:', updateError);
      return res.status(500).json({ 
        message: 'Failed to update usage count.', 
        details: updateError?.message 
      });
    }

    console.log(`Daily News generated for user ${user.id}. Generations now ${userRecord.generations + 1}`);

    return res.status(200).json({ text: cleanedText });

  } catch (error) {
    console.error('Unhandled server error:', error);
    return res.status(500).json({ 
      message: 'Server error', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
