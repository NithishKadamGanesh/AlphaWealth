// ui/src/components/AvatarUploader.jsx
// Clickable profile avatar. Shows the saved photo (or initials fallback) and,
// on click, lets the user pick an image. The image is downscaled + center-
// cropped to a small square and stored in localStorage as a data URL — no
// backend, no large blobs.

import { useRef, useState, useEffect, useCallback } from "react";
import { Camera, X } from "lucide-react";
import { getAvatar, setAvatar, getDisplayName, initialsFromName } from "../lib/userPrefs";

// Downscale + center-crop a File to a square JPEG data URL.
function fileToSquareDataUrl(file, size = 192, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(im.width, im.height);
      const sx = (im.width - side) / 2;
      const sy = (im.height - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(im, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    im.src = url;
  });
}

export function AvatarUploader({ size = 28, name, editable = true, className = "" }) {
  const [avatar, setAvatarState] = useState(getAvatar());
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const displayName = name ?? getDisplayName();

  // Keep in sync if another component (e.g. Settings) changes it.
  useEffect(() => {
    const sync = () => setAvatarState(getAvatar());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const onPick = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setBusy(true);
      const dataUrl = await fileToSquareDataUrl(file);
      setAvatar(dataUrl);
      setAvatarState(dataUrl);
      window.dispatchEvent(new Event("storage"));
    } catch { /* ignore unreadable images */ } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback((e) => {
    e.stopPropagation();
    setAvatar("");
    setAvatarState("");
    window.dispatchEvent(new Event("storage"));
  }, []);

  const px = { width: size, height: size };
  const fontPx = Math.max(10, Math.round(size * 0.4));

  return (
    <div className={`relative shrink-0 ${className}`} style={px}>
      <button
        type="button"
        onClick={() => editable && inputRef.current?.click()}
        disabled={!editable || busy}
        title={editable ? "Change profile photo" : undefined}
        className="group relative w-full h-full rounded-full overflow-hidden flex items-center justify-center
                   bg-gradient-to-br from-accent to-positive text-white font-semibold
                   focus:outline-none focus:ring-2 focus:ring-accent/50"
        style={{ fontSize: fontPx }}
        aria-label="Profile photo"
      >
        {avatar
          ? <img src={avatar} alt={displayName} className="w-full h-full object-cover" />
          : <span>{initialsFromName(displayName)}</span>}

        {editable && (
          <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-ink/55">
            <Camera size={Math.max(11, Math.round(size * 0.42))} className="text-white" />
          </span>
        )}
      </button>

      {editable && avatar && (
        <button
          type="button"
          onClick={remove}
          title="Remove photo"
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-ink text-white border border-canvas
                     flex items-center justify-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
        >
          <X size={9} strokeWidth={3} />
        </button>
      )}

      {editable && (
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      )}
    </div>
  );
}
