import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const testPrompt = `
PROYECTO LITERARIO

TÍTULO: "Sombras en el agua"
GÉNERO: mystery
TONO: suspenseful
CAPÍTULOS: 35 (+ Prólogo + Epílogo)

FASE 1A: Genera PERSONAJES (5-7 principales) y PREMISA.

Responde con JSON:
{
  "premisa": "resumen de 2-3 frases de la historia principal",
  "personajes": [
    { 
      "nombre": "...", 
      "rol": "protagonista|antagonista|secundario",
      "descripcion_fisica": "...",
      "psicologia": "...",
      "motivacion": "...",
      "arco_personal": "..."
    }
  ]
}

⛔ MÁXIMO 7 PERSONAJES. Solo los esenciales.
`;

async function test() {
  console.log("Testing DeepSeek FASE 1A-style prompt...");
  console.log("Prompt length:", testPrompt.length, "chars");
  
  const startTime = Date.now();
  
  try {
    const response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      max_tokens: 8192,
      temperature: 0.7,
      messages: [
        { role: "system", content: "Eres un arquitecto literario experto. Responde SOLO con JSON válido, sin markdown." },
        { role: "user", content: testPrompt }
      ],
    });
    
    const elapsed = Date.now() - startTime;
    console.log("\nResponse in " + Math.round(elapsed/1000) + "s");
    console.log("Model:", response.model);
    console.log("Finish reason:", response.choices?.[0]?.finish_reason);
    console.log("Usage:", JSON.stringify(response.usage));
    
    const content = response.choices?.[0]?.message?.content || "";
    console.log("\nContent length:", content.length);
    console.log("Content preview (first 1500 chars):");
    console.log(content.substring(0, 1500));
    
    // Try to parse JSON
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        console.log("\n✅ JSON parsed successfully!");
        console.log("Personajes count:", data.personajes?.length || 0);
        if (data.personajes?.length > 0) {
          console.log("First character:", data.personajes[0].nombre);
        }
      } else {
        console.log("\n❌ No JSON found in response");
      }
    } catch (e: any) {
      console.log("\n❌ JSON parse error:", e.message);
    }
    
  } catch (error: any) {
    console.error("API Error:", error.message);
    console.error("Status:", error.status);
    if (error.error) {
      console.error("Error details:", JSON.stringify(error.error));
    }
  }
}

test();
