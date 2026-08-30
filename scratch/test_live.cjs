const dotenv = require('dotenv');
dotenv.config();
const { GoogleGenAI, Modality } = require('@google/genai');

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  console.log('Testing raw ai.live.connect...');

  try {
    const session = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      callbacks: {
        onopen: () => console.log('🟢 Raw onopen fired!'),
        onclose: (e) => console.log('🔌 Raw onclose fired:', e),
        onerror: (e) => console.log('❌ Raw onerror fired:', e),
        onmessage: (m) => console.log('📩 Message:', m),
      },
      config: {
        responseModalities: [Modality.AUDIO],
      }
    });

    console.log('Session connect returned object successfully!');
    await new Promise(r => setTimeout(r, 4000));
    await session.close();
    console.log('Test 1 Passed!');
  } catch (err) {
    console.error('Test 1 Failed:', err);
  }
}

test();
