#!/usr/bin/env python3
"""Hablante activo ligero: puntúa el movimiento de la boca de cada persona a lo largo de un clip.

Entrada: una carpeta con fotogramas f0001.jpg, f0002.jpg... muestreados a --fps (por defecto 6) del tramo del clip.
Método (solo OpenCV, sin modelos descargables):
  1. Detecta caras con el clasificador Haar en cada fotograma.
  2. Fija un puesto por persona con la mediana de sus cajas en los fotogramas donde se ven todas (cámara fija).
  3. En cada puesto mide la diferencia entre fotogramas consecutivos en la zona de la boca (tercio inferior de la cara).
  4. Agrega por ventanas de --window segundos.
La decisión de quién habla (cruzando con la voz de la transcripción) se hace en pipeline/asd.mjs.

Salida (JSON por stdout): {"fps", "window", "frames", "slots": [{"x","y","w","h"}...], "windows": [{"t", "scores": [...]}...]}
Si no hay al menos dos personas fijas, "slots" trae menos de dos entradas y "windows" va vacío.
"""
import argparse
import glob
import json
import os
import sys

import cv2
import numpy as np

CASCADE = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"


def detect_faces(gray, cascade):
    height, width = gray.shape
    size = max(24, int(width * 0.05))
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(size, size))
    return [(x / width, y / height, w / width, h / height) for (x, y, w, h) in faces]


def fixed_slots(per_frame):
    """Puestos de cada persona: mediana de las cajas en los fotogramas con el número de caras más frecuente."""
    counts = [len(faces) for faces in per_frame if faces]
    if not counts:
        return []
    target = max(set(counts), key=counts.count)
    target = min(target, 4)
    if target < 2:
        return []
    samples = [sorted(faces, key=lambda box: box[0] + box[2] / 2)[:target] for faces in per_frame if len(faces) == target]
    if len(samples) < 3:
        return []
    slots = []
    for index in range(target):
        boxes = np.array([sample[index] for sample in samples])
        x, y, w, h = np.median(boxes, axis=0)
        slots.append({"x": round(float(x), 4), "y": round(float(y), 4), "w": round(float(w), 4), "h": round(float(h), 4)})
    # Dos personas no pueden ocupar prácticamente el mismo sitio.
    for left, right in zip(slots, slots[1:]):
        if abs((left["x"] + left["w"] / 2) - (right["x"] + right["w"] / 2)) < 0.12:
            return []
    return slots


def _region_crop(gray, slot, y_start, y_end):
    height, width = gray.shape
    x0 = int((slot["x"] + slot["w"] * 0.2) * width)
    x1 = int((slot["x"] + slot["w"] * 0.8) * width)
    y0 = int((slot["y"] + slot["h"] * y_start) * height)
    y1 = int((slot["y"] + slot["h"] * y_end) * height)
    crop = gray[max(0, y0):max(y0 + 2, y1), max(0, x0):max(x0 + 2, x1)]
    if crop.size == 0:
        return None
    return cv2.resize(crop, (32, 16), interpolation=cv2.INTER_AREA).astype(np.float32)


def mouth_crop(gray, slot):
    return _region_crop(gray, slot, 0.58, 0.98)


def upper_face_crop(gray, slot):
    return _region_crop(gray, slot, 0.14, 0.46)


def analyze(directory, fps, window):
    files = sorted(glob.glob(os.path.join(directory, "f*.jpg")))
    if len(files) < 4:
        return {"fps": fps, "window": window, "frames": len(files), "slots": [], "windows": []}
    cascade = cv2.CascadeClassifier(CASCADE)
    grays, per_frame = [], []
    for path in files:
        image = cv2.imread(path)
        if image is None:
            continue
        gray = cv2.equalizeHist(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))
        grays.append(gray)
        per_frame.append(detect_faces(gray, cascade))
    slots = fixed_slots(per_frame)
    if len(slots) < 2:
        return {"fps": fps, "window": window, "frames": len(grays), "slots": slots, "windows": []}

    crops = [[mouth_crop(gray, slot) for slot in slots] for gray in grays]
    upper_crops = [[upper_face_crop(gray, slot) for slot in slots] for gray in grays]
    motion = np.zeros((len(slots), len(grays)))
    for index in range(1, len(grays)):
        for slot in range(len(slots)):
            a, b = crops[index - 1][slot], crops[index][slot]
            ua, ub = upper_crops[index - 1][slot], upper_crops[index][slot]
            if a is not None and b is not None:
                # Se resta la media para ignorar cambios de brillo y parte del movimiento de frente/ojos
                # para no confundir asentimientos o sacudidas de cabeza con hablar.
                mouth_diff = float(np.mean(np.abs((b - b.mean()) - (a - a.mean())))) / 255.0
                upper_diff = float(np.mean(np.abs((ub - ub.mean()) - (ua - ua.mean())))) / 255.0 if (ua is not None and ub is not None) else 0.0
                motion[slot, index] = max(0.0, mouth_diff - 0.65 * upper_diff)

    per_window = max(1, int(round(fps * window)))
    windows = []
    for start in range(0, len(grays), per_window):
        block = motion[:, start:start + per_window]
        windows.append({"t": round(start / fps, 3), "scores": [round(float(v), 5) for v in block.mean(axis=1)]})
    return {"fps": fps, "window": window, "frames": len(grays), "slots": slots, "windows": windows}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("frames_dir")
    parser.add_argument("--fps", type=float, default=6.0)
    parser.add_argument("--window", type=float, default=0.5)
    args = parser.parse_args()
    json.dump(analyze(args.frames_dir, args.fps, args.window), sys.stdout)


if __name__ == "__main__":
    main()
