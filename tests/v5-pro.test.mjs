import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioGraph, VOICE_POLISH_CHAIN } from '../pipeline/audio.mjs';
import { chooseClips } from '../pipeline/analysis.mjs';

test('buildAudioGraph inserta Studio Voice Polish antes de bleep/ducking cuando voicePolish=true', () => {
  const res = buildAudioGraph({ duration: 12, voicePolish: true, sfx: [] });
  const joined = Array.isArray(res.graph) ? res.graph.join(';') : String(res.graph);
  assert.ok(joined.includes(VOICE_POLISH_CHAIN), 'debe incluir la cadena vocal broadcast');
  assert.ok(joined.includes('[voice_polished]'), 'debe etiquetar la pista pulida');

  const raw = buildAudioGraph({ duration: 12, voicePolish: false, sfx: [] });
  const rawStr = Array.isArray(raw.graph) ? raw.graph.join(';') : String(raw.graph);
  assert.ok(!rawStr.includes('dynaudnorm'), 'no debe aplicar polish cuando está desactivado');
});

test('chooseClips inyecta focusPrompt del creador en el system prompt de la IA', async () => {
  let capturedSystem = '';
  const fakeInfer = async (req) => {
    capturedSystem = req.system;
    return { clips: [] };
  };
  const transcript = {
    language: 'es',
    segments: [
      { id: 1, start: 0, end: 5, text: 'Hola', energy: 5 },
      { id: 2, start: 5, end: 15, text: 'Momento de prueba', energy: 8 },
    ],
  };
  await chooseClips(fakeInfer, transcript, { duration: 20 }, async () => {}, false, {
    focusPrompt: 'Solo momentos de risa extrema y sustos en el juego',
  });
  assert.ok(capturedSystem.includes('Solo momentos de risa extrema y sustos en el juego'));
});
