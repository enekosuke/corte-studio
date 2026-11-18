"""Hybrid local AI vision analyzer: EmbeddingGemma 2 + SigLIP 2 + YOLO-Face + YOLO11-Pose + OpenCV edge snap."""

import json
import os
from pathlib import Path
from statistics import median
import sys
import warnings

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
warnings.filterwarnings("ignore")

import cv2
import numpy as np

MODELS_DIR = Path(__file__).resolve().parent.parent / ".corte-data" / "vision-models"

ARCHETYPES = [
    ("gameplay", "a video game gameplay screen with a small streamer webcam box overlay in the corner"),
    ("shared", "a computer screen software tutorial slides browser or code with a presenter webcam"),
    ("split", "two people having an interview debate conversation side by side"),
    ("group", "three or more people together in a studio panel group challenge"),
    ("solo", "one single person centered speaking directly to the camera in a solo video"),
    ("wide", "wide outdoor travel crowd street scene or cinematic shot without a fixed host"),
]
SCENE_LABELS = [item[0] for item in ARCHETYPES]

_AI_ENGINE = None


def _clip01(val):
    return max(0.0, min(1.0, float(val)))


def _round_box(left, top, right, bottom):
    return {
        "left": round(_clip01(left), 4),
        "top": round(_clip01(top), 4),
        "right": round(_clip01(right), 4),
        "bottom": round(_clip01(bottom), 4),
    }


def recurring_bounds(images, x, y, expected_width, expected_height):
    """Snap to persistent rectangular overlay edges around (x, y) across frames."""
    if not images:
        return None
    height, width = images[0].shape
    edges = np.mean([cv2.Canny(image, 40, 120) > 0 for image in images], axis=0)
    thresh = 0.55 if len(images) >= 2 else 0.5
    edges = (edges >= thresh).astype(np.uint8)

    def edge(profile, size, center, extent, side):
        if side < 0 and center - extent * 0.60 <= 0.022:
            return 0.0
        if side > 0 and center + extent * 0.60 >= 0.978:
            return 1.0
        nearby = sorted((center + side * extent * 0.20, center + side * extent * 1.12))
        low, high = max(0, int(nearby[0] * size)), min(size, int(nearby[1] * size) + 1)
        if high <= low:
            return None
        segment = profile[low:high]
        index = int(np.argmax(segment)) + low
        if profile[index] < 0.14:
            return None
        return index / size

    y1 = max(0, int((y - expected_height * 0.36) * height))
    y2 = min(height, int((y + expected_height * 0.36) * height) + 1)
    x1 = max(0, int((x - expected_width * 0.36) * width))
    x2 = min(width, int((x + expected_width * 0.36) * width) + 1)
    if y2 <= y1 or x2 <= x1:
        return None

    columns = edges[y1:y2, :].mean(axis=0)
    rows = edges[:, x1:x2].mean(axis=1)
    left = edge(columns, width, x, expected_width, -1)
    right = edge(columns, width, x, expected_width, 1)
    top = edge(rows, height, y, expected_height, -1)
    bottom = edge(rows, height, y, expected_height, 1)
    if None in (left, top, right, bottom):
        return None
    if not (0.65 * expected_width <= right - left <= 1.45 * expected_width and
            0.65 * expected_height <= bottom - top <= 1.45 * expected_height):
        return None
    return _round_box(left, top, right, bottom)


def snap_webcam_box(grays, face_box, person_box):
    """Anchor webcam box tightly around YOLO face + person torso and snap outer Canny edges."""
    f_l, f_t, f_r, f_b = face_box["left"], face_box["top"], face_box["right"], face_box["bottom"]
    f_cx, f_cy = (f_l + f_r) / 2, (f_t + f_b) / 2
    fw, fh = max(0.02, f_r - f_l), max(0.02, f_b - f_t)

    if person_box and (person_box["right"] - person_box["left"]) < 0.44 and (person_box["bottom"] - person_box["top"]) < 0.56:
        base = [
            min(f_l, person_box["left"]),
            min(f_t, person_box["top"]),
            max(f_r, person_box["right"]),
            max(f_b, person_box["bottom"]),
        ]
    else:
        base = [
            max(0.0, f_cx - fw * 1.8),
            max(0.0, f_cy - fh * 1.4),
            min(1.0, f_cx + fw * 1.8),
            min(1.0, f_cy + fh * 2.1),
        ]

    if not grays:
        return _round_box(*base)

    h, w = grays[0].shape
    edges = np.mean([cv2.Canny(im, 40, 120) > 0 for im in grays], axis=0) if len(grays) >= 2 else (cv2.Canny(grays[0], 45, 130) > 0).astype(np.float32)
    if len(grays) >= 2:
        edges = (edges >= 0.55).astype(np.float32)

    b_l, b_t, b_r, b_b = base
    bw, bh = max(0.08, b_r - b_l), max(0.08, b_b - b_t)
    y1, y2 = max(0, int(b_t * h)), min(h, int(b_b * h))
    x1, x2 = max(0, int(b_l * w)), min(w, int(b_r * w))
    if y2 <= y1 or x2 <= x1:
        return _round_box(*base)

    col_prof = edges[y1:y2, :].mean(axis=0)
    row_prof = edges[:, x1:x2].mean(axis=1)

    def find_outer(prof, size, inner_edge, outer_limit, is_start):
        lo, hi = (
            (max(0, int(outer_limit * size)), min(size, int(inner_edge * size) + 1))
            if is_start
            else (max(0, int(inner_edge * size)), min(size, int(outer_limit * size) + 1))
        )
        if hi <= lo:
            return inner_edge
        idx = int(np.argmax(prof[lo:hi])) + lo
        return idx / size if prof[idx] >= 0.25 else inner_edge

    sl = 0.0 if b_l <= 0.03 else find_outer(col_prof, w, b_l + bw * 0.08, max(0.0, b_l - 0.08), True)
    sr = 1.0 if b_r >= 0.97 else find_outer(col_prof, w, b_r - bw * 0.08, min(1.0, b_r + 0.08), False)
    st = 0.0 if b_t <= 0.03 else find_outer(row_prof, h, b_t + bh * 0.08, max(0.0, b_t - 0.14), True)
    sb = 1.0 if b_b >= 0.97 else find_outer(row_prof, h, b_b - bh * 0.08, min(1.0, b_b + 0.05), False)
    if sr - sl < 0.08 or sb - st < 0.08:
        return _round_box(*base)
    return _round_box(sl, st, sr, sb)


def _is_corner_person(f_box, p_box):
    fw, fh = f_box["right"] - f_box["left"], f_box["bottom"] - f_box["top"]
    fcx, fcy = (f_box["left"] + f_box["right"]) / 2, (f_box["top"] + f_box["bottom"]) / 2
    in_corner = fcx < 0.34 or fcx > 0.66 or fcy < 0.32 or fcy > 0.68
    if not in_corner or fw >= 0.22 or fh >= 0.30:
        return False
    if p_box is not None:
        pw, ph = p_box["right"] - p_box["left"], p_box["bottom"] - p_box["top"]
        if pw > 0.44 or ph > 0.56:
            return False
    return True


def _get_ai_engine():
    """Lazy-load local AI vision ensemble with strict VRAM/RAM budget guards."""
    global _AI_ENGINE
    if _AI_ENGINE is not None:
        return _AI_ENGINE

    engine = {
        "face": None,
        "pose": None,
        "eg_model": None,
        "eg_proc": None,
        "eg_text": None,
        "siglip_model": None,
        "siglip_proc": None,
        "siglip_text": None,
        "torch": None,
        "device": "cpu",
    }

    try:
        import torch
        engine["torch"] = torch
        free_gb = 0.0
        if torch.cuda.is_available():
            free_bytes, _ = torch.cuda.mem_get_info()
            free_gb = free_bytes / (1024 ** 3)
        yolo_dev = "cuda" if free_gb >= 0.9 else "cpu"
        engine["device"] = yolo_dev

        from ultralytics import YOLO
        face_w = MODELS_DIR / "face_yolov8s.pt"
        pose_w = MODELS_DIR / "yolo11n-pose.pt"
        if face_w.exists():
            engine["face"] = YOLO(str(face_w)).to(yolo_dev)
        if pose_w.exists():
            engine["pose"] = YOLO(str(pose_w)).to(yolo_dev)

        # Load SigLIP 2 (only ~830 MB VRAM, 8 ms/img) whenever >= 1.8 GB free VRAM.
        siglip_dir = MODELS_DIR / "siglip2-base-patch16-256"
        if siglip_dir.exists() and free_gb >= 1.8:
            from transformers import AutoModel, AutoProcessor
            s_proc = AutoProcessor.from_pretrained(str(siglip_dir))
            s_model = AutoModel.from_pretrained(str(siglip_dir), dtype=torch.bfloat16).to("cuda").eval()
            with torch.inference_mode():
                s_ti = s_proc(text=[a[1] for a in ARCHETYPES], padding="max_length", max_length=64, truncation=True, return_tensors="pt").to("cuda")
                out = s_model.get_text_features(**s_ti)
                t_feat = out.pooler_output if hasattr(out, "pooler_output") and out.pooler_output is not None else out[0]
                engine["siglip_text"] = torch.nn.functional.normalize(t_feat.float(), p=2, dim=-1)
            engine["siglip_proc"] = s_proc
            engine["siglip_model"] = s_model

        # Add EmbeddingGemma 2 (440M Vision+Text, BF16, ~1.35 GB VRAM) whenever >= 3.2 GB free VRAM.
        eg_dir = MODELS_DIR / "embeddinggemma-2"
        if eg_dir.exists() and free_gb >= 3.2:
            from transformers import AutoConfig, AutoModel, AutoProcessor
            cfg = AutoConfig.from_pretrained(str(eg_dir))
            if hasattr(cfg, "audio_config"):
                cfg.audio_config = None
            eg_proc = AutoProcessor.from_pretrained(str(eg_dir))
            eg_model = AutoModel.from_pretrained(str(eg_dir), config=cfg, dtype=torch.bfloat16).to("cuda").eval()
            with torch.inference_mode():
                eg_ti = eg_proc(text=[f"task: classification | query: {a[1]}" for a in ARCHETYPES], padding=True, return_tensors="pt").to("cuda")
                out = eg_model(**eg_ti)
                if hasattr(out, "pooler_output") and out.pooler_output is not None:
                    t_emb = out.pooler_output
                else:
                    mask = eg_ti["attention_mask"].unsqueeze(-1).to(out.last_hidden_state.dtype)
                    t_emb = (out.last_hidden_state * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
                engine["eg_text"] = torch.nn.functional.normalize(t_emb.float(), p=2, dim=-1)
            engine["eg_proc"] = eg_proc
            engine["eg_model"] = eg_model
    except Exception:
        pass

    _AI_ENGINE = engine
    return _AI_ENGINE


def _classify_frames_ai(engine, paths):
    """Run batched EmbeddingGemma 2 + SigLIP 2 multimodal encoding for scene scores + semantic cuts."""
    torch = engine.get("torch")
    if not torch or (engine["eg_model"] is None and engine["siglip_model"] is None):
        return None, None
    from PIL import Image

    pil_imgs = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        im.thumbnail((512, 512))
        pil_imgs.append(im)

    eg_scores = None
    eg_vecs = None
    s_probs = None
    s_vecs = None

    with torch.inference_mode():
        if engine["eg_model"] is not None:
            vi = engine["eg_proc"](text=["<|image|>"] * len(pil_imgs), images=[[im] for im in pil_imgs], padding=True, return_tensors="pt").to("cuda")
            out = engine["eg_model"](**vi)
            if hasattr(out, "pooler_output") and out.pooler_output is not None:
                v_emb = out.pooler_output
            else:
                mask = vi["attention_mask"].unsqueeze(-1).to(out.last_hidden_state.dtype)
                v_emb = (out.last_hidden_state * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
            v_emb = torch.nn.functional.normalize(v_emb.float(), p=2, dim=-1)
            eg_vecs = v_emb.cpu().numpy()
            eg_scores = (v_emb @ engine["eg_text"].T).cpu().numpy()

        if engine["siglip_model"] is not None:
            vi = engine["siglip_proc"](images=pil_imgs, return_tensors="pt").to("cuda", dtype=torch.bfloat16)
            out = engine["siglip_model"].get_image_features(**vi)
            v_feat = out.pooler_output if hasattr(out, "pooler_output") and out.pooler_output is not None else out[0]
            v_feat = torch.nn.functional.normalize(v_feat.float(), p=2, dim=-1)
            s_vecs = v_feat.cpu().numpy()
            s_probs = torch.softmax((v_feat @ engine["siglip_text"].T) * engine["siglip_model"].logit_scale.exp().float(), dim=-1).cpu().numpy()

    vecs = eg_vecs if eg_vecs is not None else s_vecs
    per_frame_probs = []
    for idx in range(len(paths)):
        if eg_scores is not None and s_probs is not None:
            eg_p = np.exp((eg_scores[idx] - eg_scores[idx].max()) / 0.04)
            eg_p /= eg_p.sum()
            combined = 0.45 * eg_p + 0.55 * s_probs[idx]
        elif eg_scores is not None:
            eg_p = np.exp((eg_scores[idx] - eg_scores[idx].max()) / 0.04)
            combined = eg_p / eg_p.sum()
        else:
            combined = s_probs[idx]
        per_frame_probs.append({lbl: float(combined[i]) for i, lbl in enumerate(SCENE_LABELS)})

    semantic_cuts = [False]
    if vecs is not None and len(vecs) > 1:
        threshold = 0.80 if eg_vecs is not None else 0.72
        for i in range(1, len(vecs)):
            sim = float(np.dot(vecs[i - 1], vecs[i]))
            semantic_cuts.append(sim < threshold)
    else:
        semantic_cuts = [False] * len(paths)

    return per_frame_probs, semantic_cuts


def _dedupe_boxes(boxes):
    kept = []
    for box in sorted(boxes, key=lambda item: (item["right"] - item["left"]) * (item["bottom"] - item["top"]), reverse=True):
        cx = (box["left"] + box["right"]) / 2
        cy = (box["top"] + box["bottom"]) / 2
        if any(abs(cx - (k["left"] + k["right"]) / 2) < 0.08 and abs(cy - (k["top"] + k["bottom"]) / 2) < 0.10 for k in kept):
            continue
        kept.append(box)
    return sorted(kept, key=lambda item: (round(item["top"], 1), item["left"]))


def _pose_head_focus(p_box, keypoints, face_box=None):
    """Build an exact head-and-torso anchor box using YOLO11 pose keypoints + face box."""
    if face_box is not None:
        fcx = (face_box["left"] + face_box["right"]) / 2
        fcy = (face_box["top"] + face_box["bottom"]) / 2
        fw, fh = face_box["right"] - face_box["left"], face_box["bottom"] - face_box["top"]
        return _round_box(
            max(p_box["left"], fcx - max(fw * 1.45, 0.12)),
            max(0.0, min(p_box["top"], f_t := face_box["top"] - fh * 0.45)),
            min(p_box["right"], fcx + max(fw * 1.45, 0.12)),
            min(p_box["bottom"], fcy + fh * 2.2),
        )
    if keypoints and len(keypoints) >= 7:
        head_pts = [pt for pt in keypoints[:5] if pt[0] > 0.01 and pt[1] > 0.01]
        if head_pts:
            hx = sum(pt[0] for pt in head_pts) / len(head_pts)
            hy = sum(pt[1] for pt in head_pts) / len(head_pts)
            pw = p_box["right"] - p_box["left"]
            ph = p_box["bottom"] - p_box["top"]
            half_w = max(0.11, min(pw * 0.52, 0.24))
            return _round_box(hx - half_w, max(0.0, hy - ph * 0.14), hx + half_w, min(1.0, hy + ph * 0.42))
    return p_box


def locate(paths, x_hint, y_hint, expected_width, expected_height):
    """Find webcam coordinates around (x_hint, y_hint) across sample frames."""
    engine = _get_ai_engine()
    samples = []
    images = []
    for path in paths:
        bgr = cv2.imread(path)
        if bgr is None:
            continue
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        images.append(gray)
        points = []
        if engine["face"] is not None:
            res = engine["face"].predict(bgr, imgsz=640, conf=0.30, max_det=12, verbose=False)[0]
            if res.boxes is not None:
                for b in res.boxes.xyxyn.cpu().tolist():
                    cx, cy, fh = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, b[3] - b[1]
                    if abs(cx - x_hint) <= 0.18 and abs(cy - y_hint) <= 0.25 and (b[2] - b[0]) < 0.24:
                        points.append((cx, cy, fh))
        if not points:
            detector = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"))
            eq = cv2.equalizeHist(cv2.resize(gray, None, fx=2, fy=2))
            height, width = eq.shape
            for x, y, w, h in detector.detectMultiScale(eq, scaleFactor=1.08, minNeighbors=4, minSize=(28, 28)):
                cx, cy = (x + w / 2) / width, (y + h / 2) / height
                if abs(cx - x_hint) <= 0.18 and abs(cy - y_hint) <= 0.25 and w / width < 0.22:
                    points.append((cx, cy, h / height))
        if points:
            samples.append(min(points, key=lambda point: abs(point[0] - x_hint) + 0.5 * abs(point[1] - y_hint)))

    if len(samples) < max(2, (len(paths) + 1) // 2):
        return None
    x, y = median(point[0] for point in samples), median(point[1] for point in samples)
    consistent = [point for point in samples if abs(point[0] - x) < 0.06 and abs(point[1] - y) < 0.09]
    if len(consistent) < max(2, (len(paths) + 1) // 2):
        return None
    bounds = recurring_bounds(images, x, y, expected_width, expected_height)
    return {"x": x, "y": y, "height": median(point[2] for point in consistent), "bounds": bounds}


def analyze_scene(paths):
    """Run hybrid AI scene classification, face/pose detection, semantic cut detection, and edge-snapped webcam localization."""
    engine = _get_ai_engine()
    valid_paths = [p for p in paths if os.path.exists(p)]
    ai_probs, semantic_cuts = _classify_frames_ai(engine, valid_paths) if valid_paths else (None, None)

    cascades = Path(cv2.data.haarcascades)
    frontal = cv2.CascadeClassifier(str(cascades / "haarcascade_frontalface_default.xml")) if engine["face"] is None else None
    profile = cv2.CascadeClassifier(str(cascades / "haarcascade_profileface.xml")) if engine["face"] is None else None

    frames = []
    grays = []
    prev_gray = None
    prev_hist = None
    corner_candidates = []

    for idx, path in enumerate(valid_paths, start=1):
        bgr = cv2.imread(path)
        if bgr is None:
            continue
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        grays.append(gray)
        h, w = gray.shape

        # 1. Faces via YOLO-Face (or Haar fallback)
        raw_faces = []
        if engine["face"] is not None:
            f_res = engine["face"].predict(bgr, imgsz=640, conf=0.34, max_det=12, verbose=False)[0]
            if f_res.boxes is not None:
                for b in f_res.boxes.xyxyn.cpu().tolist():
                    raw_faces.append(_round_box(b[0], b[1], b[2], b[3]))
        else:
            eq = cv2.equalizeHist(gray)
            for fx, fy, fw, fh in frontal.detectMultiScale(eq, scaleFactor=1.1, minNeighbors=4, minSize=(22, 22)):
                raw_faces.append(_round_box(fx / w, fy / h, (fx + fw) / w, (fy + fh) / h))
            if not profile.empty():
                for fx, fy, fw, fh in profile.detectMultiScale(eq, scaleFactor=1.12, minNeighbors=4, minSize=(22, 22)):
                    raw_faces.append(_round_box(fx / w, fy / h, (fx + fw) / w, (fy + fh) / h))
                flipped = cv2.flip(eq, 1)
                for fx, fy, fw, fh in profile.detectMultiScale(flipped, scaleFactor=1.12, minNeighbors=4, minSize=(22, 22)):
                    raw_faces.append(_round_box((w - fx - fw) / w, fy / h, (w - fx) / w, (fy + fh) / h))
        faces = _dedupe_boxes(raw_faces)[:4]

        # 2. Person boxes + pose keypoints via YOLO11n-Pose
        persons = []
        if engine["pose"] is not None:
            p_res = engine["pose"].predict(bgr, imgsz=640, conf=0.30, max_det=10, verbose=False)[0]
            if p_res.boxes is not None:
                boxes_list = p_res.boxes.xyxyn.cpu().tolist()
                kps_list = p_res.keypoints.xyn.cpu().tolist() if p_res.keypoints is not None else [[] for _ in boxes_list]
                for pb, kps in zip(boxes_list, kps_list):
                    p_box = _round_box(pb[0], pb[1], pb[2], pb[3])
                    pcx, pcy = (p_box["left"] + p_box["right"]) / 2, (p_box["top"] + p_box["bottom"]) / 2
                    matched_face = next(
                        (fb for fb in faces if p_box["left"] <= (fb["left"] + fb["right"]) / 2 <= p_box["right"] and p_box["top"] <= (fb["top"] + fb["bottom"]) / 2 <= p_box["bottom"]),
                        None,
                    )
                    persons.append({
                        "box": p_box,
                        "focus": _pose_head_focus(p_box, kps, matched_face),
                        "area": round((p_box["right"] - p_box["left"]) * (p_box["bottom"] - p_box["top"]), 4),
                    })
                persons.sort(key=lambda item: item["box"]["left"])

        # 3. Visual histogram + semantic cut + OpenCV salience
        hist = cv2.calcHist([gray], [0], None, [16], [0, 256])
        cv2.normalize(hist, hist)
        hist_cut = False
        edges = cv2.Canny(gray, 55, 140)
        salience = cv2.GaussianBlur(edges.astype(np.float32), (25, 25), 0)
        if prev_gray is not None and prev_gray.shape == gray.shape:
            correl = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL)
            hist_cut = bool(correl < 0.78)
            if not hist_cut:
                diff = cv2.absdiff(prev_gray, gray).astype(np.float32)
                salience = salience * 0.4 + cv2.GaussianBlur(diff, (25, 25), 0) * 1.4

        sem_cut = semantic_cuts[idx - 1] if semantic_cuts and idx - 1 < len(semantic_cuts) else False
        cut_before = bool(hist_cut or sem_cut)

        threshold = float(np.percentile(salience, 84))
        ys, xs = np.where(salience >= max(4.0, threshold))
        if len(xs) >= 12:
            action_box = _round_box(
                max(0.0, min(0.85, float(np.percentile(xs, 8) / w))),
                max(0.0, min(0.85, float(np.percentile(ys, 8) / h))),
                max(0.15, min(1.0, float(np.percentile(xs, 92) / w))),
                max(0.15, min(1.0, float(np.percentile(ys, 92) / h))),
            )
        else:
            action_box = {"left": 0.2, "top": 0.15, "right": 0.8, "bottom": 0.85}

        # 4. Per-frame corner webcam check + EmbeddingGemma 2 / SigLIP 2 classification fusion
        matched_corner = None
        for fb in faces:
            fcx, fcy = (fb["left"] + fb["right"]) / 2, (fb["top"] + fb["bottom"]) / 2
            matched_p = next(
                (p["box"] for p in persons if p["box"]["left"] <= fcx <= p["box"]["right"] and p["box"]["top"] <= fcy <= p["box"]["bottom"]),
                None,
            )
            if _is_corner_person(fb, matched_p):
                matched_corner = (fb, matched_p)
                break

        frame_probs = dict(ai_probs[idx - 1]) if ai_probs and idx - 1 < len(ai_probs) else None
        scene_type = None
        if frame_probs is not None:
            if matched_corner is not None:
                frame_probs["gameplay"] *= 1.45
                frame_probs["shared"] *= 1.35
            else:
                frame_probs["gameplay"] *= 0.45
                frame_probs["shared"] *= 0.55
            if len(persons) >= 3:
                frame_probs["group"] *= 1.35
                frame_probs["solo"] *= 0.55
            elif len(persons) == 2:
                frame_probs["split"] *= 1.32
                frame_probs["solo"] *= 0.62
            elif len(persons) == 1 and matched_corner is None:
                frame_probs["solo"] *= 1.35
            tot = sum(frame_probs.values()) or 1.0
            frame_probs = {k: round(v / tot, 3) for k, v in frame_probs.items()}
            scene_type = max(frame_probs, key=frame_probs.get)

        if matched_corner is not None:
            fb, mp = matched_corner
            corner_candidates.append((len(frames), (fb["left"] + fb["right"]) / 2, (fb["top"] + fb["bottom"]) / 2, fb, mp))

        # Prefer tight pose focus boxes as faces/targets for fill & split when available.
        focus_targets = [p["focus"] for p in persons] if persons else faces
        frames.append({
            "index": idx,
            "cutBefore": cut_before,
            "faces": focus_targets,
            "rawFaces": faces,
            "personCount": len(persons),
            "actionBox": action_box,
            **({"sceneType": scene_type, "sceneScores": frame_probs} if scene_type else {}),
        })
        prev_gray = gray
        prev_hist = hist

    # Refine per-cluster corner webcam boxes cleanly with multi-frame Canny edge snap.
    inset = None
    if grays and len(corner_candidates) >= max(2, int(len(frames) * 0.45)):
        best_cluster = max(
            (
                [p for p in corner_candidates if abs(p[1] - cand[1]) < 0.12 and abs(p[2] - cand[2]) < 0.14]
                for cand in corner_candidates
            ),
            key=len,
        )
        for cand in corner_candidates:
            cluster = [q for q in corner_candidates if abs(q[1] - cand[1]) < 0.12 and abs(q[2] - cand[2]) < 0.14]
            if len(cluster) >= 2:
                c_imgs = [grays[q[0]] for q in cluster if q[0] < len(grays)]
                # Median face + person across frames of the cluster
                med_fb = {
                    k: median(q[3][k] for q in cluster)
                    for k in ("left", "top", "right", "bottom")
                }
                p_list = [q[4] for q in cluster if q[4] is not None]
                med_pb = {k: median(pb[k] for pb in p_list) for k in ("left", "top", "right", "bottom")} if p_list else None
                cam_box = snap_webcam_box(c_imgs, med_fb, med_pb)
                frames[cand[0]]["cameraBox"] = cam_box

        # Check ensemble verdict across cluster frames so studio hosts aren't mislabeled as gameplay.
        cluster_gameplay_score = sum(
            (frames[q[0]].get("sceneScores", {}).get("gameplay", 0.0) + frames[q[0]].get("sceneScores", {}).get("shared", 0.0))
            for q in best_cluster
        ) / max(1, len(best_cluster))
        allow_inset = (ai_probs is None) or (cluster_gameplay_score >= 0.28)
        if allow_inset and len(best_cluster) >= max(2, int(np.ceil(len(frames) * 0.62))):
            c_imgs = [grays[q[0]] for q in best_cluster if q[0] < len(grays)]
            med_fb = {k: median(q[3][k] for q in best_cluster) for k in ("left", "top", "right", "bottom")}
            p_list = [q[4] for q in best_cluster if q[4] is not None]
            med_pb = {k: median(pb[k] for pb in p_list) for k in ("left", "top", "right", "bottom")} if p_list else None
            cam = snap_webcam_box(c_imgs or grays, med_fb, med_pb)
            screen = {"left": 0.0, "top": 0.0, "right": 1.0, "bottom": 1.0}
            if cam["left"] < 0.35 and cam["right"] < 0.45:
                screen["left"] = round(min(0.45, cam["right"] + 0.014), 4)
            elif cam["right"] > 0.65 and cam["left"] > 0.55:
                screen["right"] = round(max(0.55, cam["left"] - 0.014), 4)
            inset_kind = "shared" if (
                ai_probs is not None and
                sum(frames[q[0]].get("sceneScores", {}).get("shared", 0.0) for q in best_cluster) >
                sum(frames[q[0]].get("sceneScores", {}).get("gameplay", 0.0) for q in best_cluster)
            ) else "gameplay"
            inset = {
                "kind": inset_kind,
                "camera": cam,
                "screen": screen,
                "coverage": round(len(best_cluster) / max(1, len(frames)), 2),
            }

    # Aggregate clip-level scene vote from EmbeddingGemma 2 + SigLIP 2
    clip_scene = None
    if ai_probs and frames:
        agg = {lbl: 0.0 for lbl in SCENE_LABELS}
        for f in frames:
            for lbl, val in f.get("sceneScores", {}).items():
                agg[lbl] += val
        tot = sum(agg.values()) or 1.0
        agg = {k: round(v / tot, 3) for k, v in agg.items()}
        clip_scene = {"dominant": max(agg, key=agg.get), "scores": agg}

    return {"frames": frames, "inset": inset, **({"scene": clip_scene} if clip_scene else {})}


def run_worker():
    """Persistent stdin/stdout NDJSON worker so vision models load only once per job."""
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            if cmd == "close":
                print(json.dumps({"ok": True}), flush=True)
                break
            if cmd == "scene":
                result = analyze_scene(req.get("paths") or [])
                print(json.dumps({"ok": True, "result": result}), flush=True)
            else:
                print(json.dumps({"ok": False, "error": "Unknown command"}), flush=True)
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        run_worker()
    elif len(sys.argv) > 1 and sys.argv[1] == "--scene":
        print(json.dumps(analyze_scene(sys.argv[2:])))
    else:
        width, height, x, y = map(float, sys.argv[1:5])
        print(json.dumps(locate(sys.argv[5:], x, y, width, height)))
