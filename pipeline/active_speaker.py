#!/usr/bin/env python3
"""Hablante activo robusto: puntúa el movimiento de la boca de cada persona a lo largo de un clip.

Entrada: una carpeta con fotogramas f0001.jpg, f0002.jpg... muestreados a --fps (por defecto 6) del tramo del clip.
Método (solo OpenCV, sin modelos descargables):
  1. Detecta caras frontales (alt2 + default) y de perfil (izquierda/derecha) con CLAHE local.
  2. Filtra falsos positivos por relación de aspecto, tamaño mínimo y varianza de textura.
  3. Agrupa detecciones por clúster espacial persistente (en vez de exigir número exacto de caras por fotograma),
     fijando el puesto de cada persona con la mediana de su clúster.
  4. Mide la diferencia de movimiento en la zona de la boca con atenuación suave de movimiento de cabeza (0.35x)
     para evitar falsos positivos al asentir sin apagar el habla real.
  5. Agrega por ventanas de --window segundos.
"""
import argparse
import glob
import json
import os
import sys

import cv2
import numpy as np

CASCADE_DIR = cv2.data.haarcascades
CASCADE_FRONTAL_ALT = CASCADE_DIR + "haarcascade_frontalface_alt2.xml"
CASCADE_FRONTAL_DEF = CASCADE_DIR + "haarcascade_frontalface_default.xml"
CASCADE_PROFILE = CASCADE_DIR + "haarcascade_profileface.xml"


def _iou(a, b):
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0.0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0.0 else 0.0


def _is_valid_face(gray, x, y, w, h, width, height):
    if w <= 0 or h <= 0:
        return False
    aspect = w / float(h)
    if aspect < 0.65 or aspect > 1.55:
        return False
    wn, hn = w / float(width), h / float(height)
    if wn < 0.04 or hn < 0.05 or wn > 0.65 or hn > 0.85:
        return False
    patch = gray[max(0, y):min(height, y + h), max(0, x):min(width, x + w)]
    if patch.size == 0 or float(np.std(patch)) < 12.0:
        return False
    return True


def _load_cascades():
    frontal_alt = cv2.CascadeClassifier(CASCADE_FRONTAL_ALT)
    frontal_def = cv2.CascadeClassifier(CASCADE_FRONTAL_DEF)
    profile = cv2.CascadeClassifier(CASCADE_PROFILE)
    return (
        frontal_alt if not frontal_alt.empty() else None,
        frontal_def if not frontal_def.empty() else None,
        profile if not profile.empty() else None,
    )


def detect_faces(gray, cascades):
    """Detecta caras frontales y de perfil (3/4) con deduplicación IoU y prioridad frontal."""
    height, width = gray.shape
    size = max(24, int(width * 0.045))
    frontal_alt, frontal_def, profile = cascades if isinstance(cascades, tuple) else (cascades, None, None)

    candidates = []
    # 1. Frontal alt2 (alta precisión, muy pocos falsos positivos)
    if frontal_alt is not None:
        for (x, y, w, h) in frontal_alt.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(size, size)):
            if _is_valid_face(gray, x, y, w, h, width, height):
                candidates.append((2, (x / width, y / height, w / width, h / height)))
    # 2. Fallback frontal default si alt2 detecta menos de 2 caras
    if frontal_def is not None and len(candidates) < 2:
        for (x, y, w, h) in frontal_def.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(size, size)):
            if _is_valid_face(gray, x, y, w, h, width, height):
                candidates.append((1, (x / width, y / height, w / width, h / height)))
    # 3. Perfil izquierdo y derecho (para entrevistas/podcasts en ángulo 3/4)
    if profile is not None and len(candidates) < 2:
        for (x, y, w, h) in profile.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=6, minSize=(size, size)):
            if _is_valid_face(gray, x, y, w, h, width, height):
                candidates.append((0, (x / width, y / height, w / width, h / height)))
        flipped = cv2.flip(gray, 1)
        for (x, y, w, h) in profile.detectMultiScale(flipped, scaleFactor=1.12, minNeighbors=6, minSize=(size, size)):
            fx = width - x - w
            if _is_valid_face(gray, fx, y, w, h, width, height):
                candidates.append((0, (fx / width, y / height, w / width, h / height)))

    # Deduplicación dando prioridad a detecciones frontales y mayor área
    candidates.sort(key=lambda item: (item[0], item[1][2] * item[1][3]), reverse=True)
    kept = []
    for _, box in candidates:
        cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
        if any(
            _iou(box, k) > 0.30 or (abs(cx - (k[0] + k[2] / 2)) < 0.08 and abs(cy - (k[1] + k[3] / 2)) < 0.10)
            for k in kept
        ):
            continue
        kept.append(box)
    return kept


def fixed_slots(per_frame):
    """Puestos de cada persona mediante agrupamiento espacial persistente en lugar de exigir recuento idéntico."""
    total_frames = len(per_frame)
    if total_frames < 3:
        return []

    clusters = []  # list of {"cx", "cy", "boxes": [...]}
    for faces in per_frame:
        used_clusters = set()
        for box in faces:
            cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
            best_idx = None
            best_dist = 0.13
            for idx, cl in enumerate(clusters):
                if idx in used_clusters:
                    continue
                dist = abs(cx - cl["cx"]) + 0.7 * abs(cy - cl["cy"])
                if dist < best_dist:
                    best_dist = dist
                    best_idx = idx
            if best_idx is not None:
                cl = clusters[best_idx]
                cl["boxes"].append(box)
                n = len(cl["boxes"])
                cl["cx"] = (cl["cx"] * (n - 1) + cx) / n
                cl["cy"] = (cl["cy"] * (n - 1) + cy) / n
                used_clusters.add(best_idx)
            else:
                clusters.append({"cx": cx, "cy": cy, "boxes": [box]})
                used_clusters.add(len(clusters) - 1)

    min_hits = max(3, int(round(total_frames * 0.32)))
    persistent = [cl for cl in clusters if len(cl["boxes"]) >= min_hits]
    persistent.sort(key=lambda cl: (len(cl["boxes"]), np.median([b[2] * b[3] for b in cl["boxes"]])), reverse=True)
    persistent = persistent[:4]
    if len(persistent) < 2:
        return []

    slots = []
    for cl in persistent:
        boxes = np.array(cl["boxes"])
        x, y, w, h = np.median(boxes, axis=0)
        slots.append({"x": round(float(x), 4), "y": round(float(y), 4), "w": round(float(w), 4), "h": round(float(h), 4)})

    slots.sort(key=lambda s: s["x"] + s["w"] / 2)
    # Dos personas no pueden ocupar prácticamente el mismo sitio horizontal.
    filtered = []
    for slot in slots:
        cx = slot["x"] + slot["w"] / 2
        if not filtered or abs(cx - (filtered[-1]["x"] + filtered[-1]["w"] / 2)) >= 0.12:
            filtered.append(slot)
    return filtered if len(filtered) >= 2 else []


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
    cascades = _load_cascades()
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    grays, per_frame = [], []
    for path in files:
        image = cv2.imread(path)
        if image is None:
            continue
        gray = clahe.apply(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))
        grays.append(gray)
        per_frame.append(detect_faces(gray, cascades))
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
                # Resta media local (iluminación) y atenúa ligeramente movimiento de cabeza (0.35x)
                # sin apagar el habla natural cuando la persona gesticula o asiente al hablar.
                mouth_diff = float(np.mean(np.abs((b - b.mean()) - (a - a.mean())))) / 255.0
                upper_diff = float(np.mean(np.abs((ub - ub.mean()) - (ua - ua.mean())))) / 255.0 if (ua is not None and ub is not None) else 0.0
                if upper_diff > 1.45 * mouth_diff:
                    # Sacudida/asentimiento puro sin apertura bucal proporcional
                    motion[slot, index] = max(0.0, mouth_diff - 0.60 * upper_diff)
                else:
                    motion[slot, index] = max(0.0, mouth_diff - 0.35 * upper_diff)

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
