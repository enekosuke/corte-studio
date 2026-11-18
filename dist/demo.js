const demo = {
  duration: 112,
  transcript: [
    { start: 0, end: 8, text: 'Cuando empecé a grabar, pensaba que necesitaba una cámara mejor. Luego vi dónde se iba la gente.' },
    { start: 8, end: 16, text: 'El problema estaba en cómo contaba la historia. Me pasaba medio minuto preparando el terreno.' },
    { start: 16, end: 24, text: 'Volví a ver mis propios vídeos con una pregunta: ¿en qué momento me habría ido yo?' },
    { start: 24, end: 30, text: 'Tu primer segundo importa. Si empiezas con un saludo, mucha gente se va.' },
    { start: 30, end: 36, text: 'Prueba a abrir con la frase que normalmente dirías al final. Esa es tu promesa.' },
    { start: 36, end: 42, text: 'Si vas a enseñar cómo arreglar una bici, empieza por mostrar la rueda girando bien.' },
    { start: 42, end: 48, text: 'Luego vuelve al problema. Ahora tu audiencia tiene un motivo para quedarse a ver cómo lo resolviste.' },
    { start: 48, end: 54, text: 'Ese cambio también me ayudó al editar clips sacados de entrevistas más largas.' },
    { start: 54, end: 61, text: 'El mejor clip que publiqué salió de una pausa. Dejé un segundo de silencio antes de la respuesta.' },
    { start: 61, end: 68, text: 'Cuando lo recortaba al máximo, la respuesta sonaba como una frase cualquiera.' },
    { start: 68, end: 75, text: 'Con la pausa se entendía que mi invitado se estaba pensando en serio lo que iba a decir.' },
    { start: 75, end: 82, text: 'Si el silencio cambia cómo entiendes la frase que viene después, ese segundo forma parte de la historia.' },
    { start: 82, end: 88, text: 'Con los subtítulos me sirvió un ejercicio parecido. Veía el vídeo entero con el móvil en silencio.' },
    { start: 88, end: 95, text: 'Lee el subtítulo antes de que desaparezca. Si te falta tiempo, prueba a repartir la frase en dos bloques.' },
    { start: 95, end: 102, text: 'Reproduce el clip otra vez. Cada bloque debería aparecer justo cuando se dice esa parte de la frase.' },
    { start: 102, end: 109, text: 'Ese pequeño ajuste da espacio para mirar la cara de quien habla y para entender lo que dice.' },
    { start: 109, end: 112, text: 'Haz la prueba con un clip que ya tengas a mano.' },
  ],
  clips: [
    { id: 'primer-segundo', start: 24, end: 48, title: 'Tu primer segundo importa', crop: 54 },
    { id: 'pausa', start: 54, end: 82, title: 'El valor de una pausa', crop: 44 },
    { id: 'subtitulos', start: 88, end: 109, title: 'Subtítulos que dan tiempo a leer', crop: 60 },
  ],
};

// The server uses the same example transcript as the browser.
if (typeof module === 'object' && module.exports) module.exports = demo;
