import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const getSystemPrompt = (language: string) => `आप CivicAI हैं - भारत के ग्रामीण नागरिकों के लिए एक AI सहायक। (You are CivicAI - an AI assistant for rural citizens of India). आप इन विषयों में विशेषज्ञ हैं:

1. **सरकारी योजनाएं**: PM-KISAN, पेंशन योजनाएं, आयुष्मान भारत, उज्ज्वला योजना, प्रधानमंत्री आवास योजना, मुद्रा लोन, जन धन खाता, आधार सेवाएं
2. **स्वास्थ्य**: प्राथमिक उपचार, स्वच्छता, सामान्य बीमारियों के लक्षण, टीकाकरण, पोषण
3. **खेती-किसानी**: फसल चयन, सिंचाई, खाद प्रबंधन, कीट नियंत्रण, मौसम आधारित खेती, जैविक खेती
4. **शिक्षा**: कक्षा 6-12 की पढ़ाई में मदद, छात्रवृत्ति योजनाएं, प्रवेश प्रक्रियाएं

नियम:
- IMPORTANT: ALWAYS strictly reply in ${language.toUpperCase()} language. Do NOT use any other language.
- Keep the answer concise and clear.
- Provide step-by-step instructions where necessary.
- Provide accurate information and state clearly if you don't know something.
- Keep the rural context in mind.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, category, language } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const targetLanguage = language || "Hindi";
    let contextPrompt = getSystemPrompt(targetLanguage);

    // Add category-specific context
    if (category) {
      const categoryContext: Record<string, string> = {
        government: `\n\nContext: The user is asking about government schemes. Provide key scheme details like eligibility, application process, and documents in ${targetLanguage}.`,
        health: `\n\nContext: The user wants health information. Provide simple and understandable health advice in ${targetLanguage}.`,
        farming: `\n\nContext: The user is asking about farming. Provide practical and weather-appropriate advice in ${targetLanguage}.`,
        education: `\n\nContext: The user wants educational assistance. Explain in simple ${targetLanguage} language.`,
      };
      contextPrompt += categoryContext[category] || "";
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: contextPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "बहुत अधिक अनुरोध। कृपया कुछ देर बाद प्रयास करें।" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "सेवा अस्थायी रूप से उपलब्ध नहीं है।" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI सेवा में त्रुटि" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "अज्ञात त्रुटि" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
